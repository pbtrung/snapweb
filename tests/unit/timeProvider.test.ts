import { describe, expect, it, vi } from 'vitest';
import { TimeProvider } from '../../src/timeProvider';

// Exchanges once per second from `from` s to `to` s on a link with 1 ms each
// way and a server clock `diff` ms ahead
function feed(tp: TimeProvider, from: number, to: number, diff: number) {
  for (let i = from; i < to; ++i) tp.addSample(i * 1000, 1 + diff, 1 - diff);
}

describe('TimeProvider', () => {
  it('starts at no difference', () => {
    expect(new TimeProvider().diffAt(0)).toBe(0);
  });

  it('takes the offset as (c2s - s2c) / 2', () => {
    const tp = new TimeProvider();
    tp.addSample(0, 10, 8);
    expect(tp.diffAt(0)).toBe(1);
    expect(tp.serverTime(1000)).toBe(1001);
  });

  it('uses the performance clock, which keeps running when audio stalls', () => {
    vi.spyOn(window.performance, 'now').mockReturnValue(1234);
    expect(new TimeProvider().now()).toBe(1234);
  });

  it('is synced after three samples', () => {
    const tp = new TimeProvider();
    feed(tp, 0, 2, 0);
    expect(tp.isSynced()).toBe(false);
    feed(tp, 2, 3, 0);
    expect(tp.isSynced()).toBe(true);
  });

  it('ignores an outlier', () => {
    const tp = new TimeProvider();
    feed(tp, 0, 10, 5);
    tp.addSample(10_000, 100, -100);
    expect(tp.diffAt(10_000)).toBe(5);
  });

  it('weights low round trips above queued replies', () => {
    const tp = new TimeProvider();
    // True diff 1 ms, 2 ms each way. Most replies waited 2..10 ms behind
    // audio, which shifts their offset by half the wait.
    for (let i = 0; i < 100; ++i) {
      const wait = i % 4 === 0 ? 0 : 2 + (i % 9);
      tp.addSample(i * 1000, 2 + 1, 2 + wait - 1);
    }
    expect(tp.diffAt(100_000)).toBe(1);
  });

  it('resets after a minute without sync', () => {
    const tp = new TimeProvider();
    for (let i = 0; i < 10; ++i) tp.addSample(i * 1000, 5, 1);
    expect(tp.diffAt(10_000)).toBe(2);
    // 61 s later, a slower link: the old samples must not win
    tp.addSample(71_000, 9, 5);
    tp.addSample(72_000, 10, 4);
    expect(tp.samples).toHaveLength(2);
  });

  it('tracks a skewed clock without lag', () => {
    const tp = new TimeProvider();
    // Server clock runs 50 ppm fast: the offset grows 0.05 ms per second
    for (let i = 0; i < 200; ++i) {
      const diff = 7 + 0.05 * i;
      tp.addSample(i * 1000, 1 + diff, 1 - diff);
    }
    expect(Math.abs(tp.diffAt(200_000) - (7 + 0.05 * 200))).toBeLessThan(0.002);
    expect(Math.abs(tp.model.skew * 1e6 - 50)).toBeLessThan(0.1);
  });

  it('clamps the skew', () => {
    const tp = new TimeProvider();
    // 1000 ppm, beyond the clamp. The 2 s round trip keeps the estimate,
    // trailing behind, from counting as a clock change.
    for (let i = 0; i < 200; ++i) {
      const diff = i;
      tp.addSample(i * 1000, 1000 + diff, 1000 - diff);
    }
    expect(tp.samples).toHaveLength(200);
    expect(tp.model.skew).toBeCloseTo(500e-6, 12);
  });

  it('moves a settled estimate in small steps', () => {
    const tp = new TimeProvider();
    for (let i = 0; i < 20; ++i) tp.addSample(i * 1000, 1.5, 0.5);
    expect(tp.diffAt(20_000)).toBe(0.5);
    // A faster route with another asymmetry: the offset is now 1.5 ms. The
    // estimate walks there in bounded steps (one exchange per second)...
    const maxStep = 0.05 + 250e-6 * 1000;
    let last = 0.5;
    let steps = 0;
    for (let i = 20; i < 100; ++i) {
      tp.addSample(i * 1000, 2.4, -0.6);
      const now = tp.diffAt(i * 1000);
      expect(Math.abs(now - last)).toBeLessThanOrEqual(maxStep + 1e-9);
      if (now !== last) steps++;
      last = now;
    }
    expect(steps).toBeGreaterThan(1);
    expect(last).toBeCloseTo(1.5, 9);
    // ...but follows a change beyond 5 ms at once
    for (let i = 100; i < 300; ++i) tp.addSample(i * 1000, 11.5, -8.5);
    expect(tp.diffAt(300_000)).toBe(10);
  });

  it('restarts when the server clock changes', () => {
    // As after a server restart or a suspend
    const tp = new TimeProvider();
    feed(tp, 0, 600, 5);
    feed(tp, 600, 602, 900);
    expect(tp.diffAt(602_000)).toBe(5);
    feed(tp, 602, 603, 900);
    expect(tp.diffAt(603_000)).toBe(900);
    expect(tp.samples).toHaveLength(3);
  });

  it('drops a stray exchange', () => {
    const tp = new TimeProvider();
    feed(tp, 0, 100, 5);
    feed(tp, 100, 101, 900);
    feed(tp, 101, 110, 5);
    expect(tp.diffAt(110_000)).toBe(5);
    expect(tp.samples).toHaveLength(109);
    expect(tp.pending).toHaveLength(0);
  });

  it('does not take a queued reply for a clock change', () => {
    // 20 ms behind audio shifts the offset by 10 ms, within its bound
    const tp = new TimeProvider();
    feed(tp, 0, 100, 0);
    for (let i = 100; i < 110; ++i) tp.addSample(i * 1000, 1, 21);
    expect(tp.pending).toHaveLength(0);
    expect(tp.samples).toHaveLength(110);
  });

  it('only uses replies to tracked requests, once, timed by their arrival', () => {
    const tp = new TimeProvider();
    vi.spyOn(tp, 'now').mockReturnValue(1000);
    tp.trackRequest(5);

    expect(tp.handleReply(6, 20, 0, 500)).toBe(false);
    expect(tp.handleReply(5, 20, 0, 500)).toBe(true);
    expect(tp.handleReply(5, 40, 0, 500)).toBe(false);
    expect(tp.samples).toEqual([{ local: 500, rtt: 20, diff: 10 }]);
  });

  it('matches request ids the way they wrap on the wire', () => {
    const tp = new TimeProvider();
    tp.trackRequest(65536 + 7);
    expect(tp.handleReply(7, 20, 0)).toBe(true);
  });

  it('drops its history and replies to requests sent before a reset', () => {
    const tp = new TimeProvider();
    tp.trackRequest(1);
    feed(tp, 0, 5, 10);

    tp.reset();
    expect(tp.samples).toEqual([]);
    expect(tp.isSynced()).toBe(false);
    expect(tp.diffAt(5000)).toBe(0);
    expect(tp.handleReply(1, 20, 0)).toBe(false);
  });
});

// ---- Simulator, ported from snapcast-rs' time_provider/sim.rs ----
//
// Replays synthetic time exchanges on snapweb's schedule (a burst of 10 at
// 25 ms, then one per second) through a modelled network with a known server
// clock (offset and skew), symmetric per-direction jitter and load-correlated
// queuing of server-to-client replies (a reply waiting behind audio). The
// estimate is compared with the true clock difference every 100 ms.

const BURST = 10;
const BURST_SPACING_MS = 25;
const SYNC_INTERVAL_MS = 1000;
const EVAL_INTERVAL_MS = 100;
// Errors are sampled once the start is long done...
const WARMUP_MS = 10_000;
// ...or from when the skew is known
const STEADY_MS = 120_000;
const SERVER_TURNAROUND_MS = 0.05;

// mulberry32: tiny, deterministic, good enough for jitter
function rng(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { uniform, exp: (mean: number) => -mean * Math.log(1 - uniform()) };
}

interface Scenario {
  name: string;
  durationS: number;
  // Server clock minus client clock at the start (ms)
  offsetMs: number;
  // Server clock rate relative to the client clock (ppm)
  skewPpm: number;
  // Fixed one-way latency, each direction (ms)
  latencyMs: number;
  // Mean of the jitter added independently per direction (ms)
  jitterMs: number;
  // Jitter is uniform in [0, 2 * jitterMs] instead of exponential
  uniformJitter: boolean;
  // Probability that a reply is queued behind audio while loaded
  queueProb: number;
  // A queued reply waits uniformly up to this long (ms)
  queueMaxMs: number;
  // Load alternates on/off with this period (s); 0 = always loaded
  loadPeriodS: number;
  seed: number;
}

function scenario(name: string, overrides: Partial<Scenario> = {}): Scenario {
  return {
    name,
    durationS: 600,
    offsetMs: 12.345,
    skewPpm: 0,
    latencyMs: 1,
    jitterMs: 0.3,
    uniformJitter: false,
    queueProb: 0,
    queueMaxMs: 0,
    loadPeriodS: 0,
    seed: 1,
    ...overrides,
  };
}

const SCENARIOS: Record<string, Scenario> = Object.fromEntries(
  [
    scenario('symmetric jitter 300us'),
    scenario('symmetric jitter 2ms', { jitterMs: 2 }),
    scenario('uniform jitter U(0,4ms)', { jitterMs: 2, uniformJitter: true }),
    scenario('s2c queuing 50% x U(0,5ms)', { queueProb: 0.5, queueMaxMs: 5 }),
    scenario('bursty load 80% x U(0,10ms)', { queueProb: 0.8, queueMaxMs: 10, loadPeriodS: 40 }),
    scenario('skew 50ppm', { skewPpm: 50 }),
    scenario('skew -120ppm, jitter 1ms', { skewPpm: -120, jitterMs: 1 }),
    scenario('skew 50ppm + s2c queuing', { skewPpm: 50, queueProb: 0.5, queueMaxMs: 5 }),
  ].map((s) => [s.name, s]),
);

interface Estimator {
  add(localMs: number, c2s: number, s2c: number): void;
  diffAt(localMs: number): number;
}

function timeProvider(): Estimator {
  const tp = new TimeProvider();
  return { add: (l, c, s) => tp.addSample(l, c, s), diffAt: (l) => tp.diffAt(l) };
}

// The estimator snapweb had before: plain median of the last 100 offsets
function plainMedian(): Estimator {
  const offsets: number[] = [];
  let diff = 0;
  return {
    add: (_l, c2s, s2c) => {
      if (offsets.push((c2s - s2c) / 2) > 100) offsets.shift();
      const sorted = [...offsets].sort((a, b) => a - b);
      diff = sorted[Math.floor(sorted.length / 2)];
    },
    diffAt: () => diff,
  };
}

interface Stats {
  mean: number;
  p50: number;
  p95: number;
  max: number;
  // Largest change of the error between two evaluations 100 ms apart: how
  // far the estimate jumps when it updates
  step: number;
}

function statsOf(errors: number[]): Stats {
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const pct = (p: number) => abs[Math.round((abs.length - 1) * p)];
  let step = 0;
  for (let i = 1; i < errors.length; ++i) step = Math.max(step, Math.abs(errors[i] - errors[i - 1]));
  return { mean, p50: pct(0.5), p95: pct(0.95), max: abs[abs.length - 1], step };
}

// Run a scenario through an estimator, returning the estimation error (ms)
// sampled from warmupMs on
function run(s: Scenario, est: Estimator, warmupMs: number = WARMUP_MS): Stats {
  const random = rng(s.seed);
  const trueDiff = (t: number) => s.offsetMs + t * s.skewPpm * 1e-6;
  const serverClock = (t: number) => t + trueDiff(t);
  const jitter = () => (s.uniformJitter ? 2 * s.jitterMs * random.uniform() : random.exp(s.jitterMs));
  const loaded = (t: number) => {
    if (s.loadPeriodS <= 0) return true;
    const period = s.loadPeriodS * 1000;
    return t % period < period / 2;
  };

  const end = s.durationS * 1000;
  const errors: number[] = [];
  let nextEval = warmupMs;
  // Replies are delivered in order, as on a TCP stream
  let lastT4 = 0;
  for (let n = 0; ; ++n) {
    const t1 = n < BURST ? n * BURST_SPACING_MS : (n - BURST + 1) * SYNC_INTERVAL_MS;
    if (t1 >= end) break;
    const arrive = t1 + s.latencyMs + jitter();
    const depart = arrive + SERVER_TURNAROUND_MS;
    let down = s.latencyMs + jitter();
    if (loaded(depart) && random.uniform() < s.queueProb) down += random.uniform() * s.queueMaxMs;
    const t4 = Math.max(depart + down, lastT4);
    lastT4 = t4;

    // Evaluate the estimate up to the moment the reply lands
    for (; nextEval < Math.min(t4, end); nextEval += EVAL_INTERVAL_MS) {
      errors.push(est.diffAt(nextEval) - trueDiff(nextEval));
    }
    // Wire values: whole microseconds
    const c2s = Math.round((serverClock(arrive) - t1) * 1000) / 1000;
    const s2c = Math.round((t4 - serverClock(depart)) * 1000) / 1000;
    est.add(t4, c2s, s2c);
  }
  return statsOf(errors);
}

describe('TimeProvider in simulation', () => {
  it('is exact on a noiseless link', () => {
    const stats = run(scenario('noiseless', { jitterMs: 0, durationS: 60 }), timeProvider());
    expect(stats.max).toBeLessThanOrEqual(0.001);
  });

  it('is unbiased under symmetric jitter', () => {
    const stats = run(SCENARIOS['symmetric jitter 300us'], timeProvider());
    expect(Math.abs(stats.mean)).toBeLessThan(0.1);
    expect(stats.p95).toBeLessThan(0.2);
  });

  it('is no worse than the plain median under symmetric jitter', () => {
    for (const name of ['symmetric jitter 300us', 'symmetric jitter 2ms', 'uniform jitter U(0,4ms)']) {
      const plain = run(SCENARIOS[name], plainMedian());
      const tp = run(SCENARIOS[name], timeProvider());
      expect(tp.p95, name).toBeLessThanOrEqual(plain.p95 * 1.1);
    }
  });

  it('is not biased by queued replies, unlike the plain median', () => {
    for (const name of ['s2c queuing 50% x U(0,5ms)', 'bursty load 80% x U(0,10ms)']) {
      const plain = run(SCENARIOS[name], plainMedian());
      const tp = run(SCENARIOS[name], timeProvider());
      expect(Math.abs(plain.mean), name).toBeGreaterThan(0.2);
      expect(Math.abs(tp.mean), name).toBeLessThan(0.05);
      expect(tp.p95, name).toBeLessThan(0.1);
    }
  });

  it('follows a skewed clock without lag, unlike the plain median', () => {
    for (const name of ['skew 50ppm', 'skew 50ppm + s2c queuing']) {
      const plain = run(SCENARIOS[name], plainMedian(), STEADY_MS);
      const tp = run(SCENARIOS[name], timeProvider(), STEADY_MS);
      // A 100 s median trails by about 50 s of drift: 2.5 ms at 50 ppm
      expect(plain.p50, name).toBeGreaterThan(2);
      expect(Math.abs(tp.mean), name).toBeLessThan(0.03);
      expect(tp.p95, name).toBeLessThan(0.1);
    }
  });

  it('never jumps', () => {
    // One exchange per second may move it by at most 0.3 ms (plus the
    // jitter of the evaluation grid against the exchanges)
    for (const s of Object.values(SCENARIOS)) {
      expect(run(s, timeProvider()).step, s.name).toBeLessThan(0.35);
    }
  });
});
