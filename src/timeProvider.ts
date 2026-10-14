// Server time synchronization, ported from snapcast-rs' TimeProvider.
//
// Exchanges are weighted by their round trip. A reply that waited (behind
// audio on the WebSocket, or on the main thread before onmessage ran) has a
// longer server-to-client leg, which skews its offset by half the wait; its
// round trip is longer by the same wait, so an offset is off by at most half
// its round trip's excess over the fastest exchange. Weighting by that excess
// discards queued replies; with symmetric jitter the weighted offsets stay
// centered on the true one.
//
// The performance clock and the server clock also run at slightly different
// rates (tens of ppm), which a median over a long window trails by half the
// window. The estimate is therefore a line, offset + skew, evaluated at the
// current time. The skew is the robust (Theil-Sen) slope of the low round trip
// exchanges of the last 20 minutes, shrunk towards 0 unless clearly above its
// noise. The offset is the weighted median offset of the last 200 exchanges,
// each moved to the current time along the skew.
//
// An exchange further from the estimate than half its round trip (plus
// JUMP_MS) proves the server clock changed; several in a row replace the
// history.
//
// All times are in milliseconds.

// Samples older than this are discarded before a new one is added
const RESET_AFTER_MS = 60_000;
// Exchanges the offset is taken from (200 s at one sync per second)
const WINDOW = 200;
// Exchanges the skew is taken from (20 minutes)
const SKEW_WINDOW = 1200;
// Only the 1 / LOW_RTT_DIVISOR of a window with the lowest round trips is used
const LOW_RTT_DIVISOR = 5;
// Largest clock skew the model accepts (ppm); crystals are within ±100
const MAX_SKEW_PPM = 500;
// The skew is only fitted once the selected exchanges span this long...
const MIN_SKEW_SPAN_MS = 20_000;
// ...and number at least this many; until then it is taken as 0
const MIN_SKEW_SAMPLES = 16;
// The selected exchanges are reduced to this many medians of consecutive
// groups before the pairwise slopes, which keeps the fit cheap
const SKEW_BINS = 16;
// Groups closer than this don't vote on the skew: their slope is mostly jitter
const MIN_PAIR_SPAN_MS = 5_000;
// The fitted skew s is scaled by s² / (s² + SKEW_SHRINK * σ²), σ being its
// standard error: a skew not clearly above the noise would add more error,
// extrapolated to the current time, than it removes
const SKEW_SHRINK = 16;
// After this many exchanges (the connect burst and 10 s of syncs) an update
// moves the estimate by at most MAX_STEP_MS plus MAX_SLEW times the time since
// the previous exchange, so playback sees no jumps when the selection changes
// or the skew becomes known...
const SETTLED_SAMPLES = 20;
const MAX_STEP_MS = 0.05;
const MAX_SLEW = 250e-6;
// ...unless the fit is further off than this: a real change, followed at once
const JUMP_MS = 5;
// Consecutive exchanges further than JUMP_MS plus half their round trip from
// the estimate that replace the history
const RESTART_SAMPLES = 3;
// Enough for the weighted median to ignore one outlier
const SYNC_MIN_SAMPLES = 3;
// Requests remembered while waiting for their replies
const MAX_PENDING_REQUESTS = 100;

// The clock difference as a line: offset + skew * (t - anchor)
interface Line {
  anchor: number;
  offset: number;
  skew: number;
}

// One time exchange
interface Sample {
  // Local time the reply arrived
  local: number;
  // c2s + s2c: the round trip minus the server's turnaround
  rtt: number;
  // (c2s - s2c) / 2: the clock difference plus half the path asymmetry
  diff: number;
}

function lineAt(line: Line, local: number): number {
  return line.offset + line.skew * (local - line.anchor);
}

// Whether the exchange rules out the line: its diff is within half its round
// trip of the true difference
function contradicts(sample: Sample, line: Line): boolean {
  return Math.abs(sample.diff - lineAt(line, sample.local)) > JUMP_MS + Math.max(sample.rtt, 0) / 2;
}

// Upper median, or undefined for no values
function median(values: number[]): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Weighted (upper) median of [value, weight] pairs
function weightedMedian(values: [number, number][]): number | undefined {
  const sorted = [...values].sort((a, b) => a[0] - b[0]);
  const half = sorted.reduce((sum, v) => sum + v[1], 0) / 2;
  let acc = 0;
  for (const [value, weight] of sorted) {
    acc += weight;
    if (acc > half) return value;
  }
  return sorted.length > 0 ? sorted[sorted.length - 1][0] : undefined;
}

// The 1 / LOW_RTT_DIVISOR of samples with the lowest round trips (among equal
// round trips the newer), in time order
function lowestRtt(samples: Sample[]): Sample[] {
  const byRtt = samples.map((s, age) => ({ s, age }));
  byRtt.sort((a, b) => a.s.rtt - b.s.rtt || b.age - a.age);
  byRtt.length = Math.ceil(byRtt.length / LOW_RTT_DIVISOR);
  byRtt.sort((a, b) => a.age - b.age);
  return byRtt.map((x) => x.s);
}

// Skew (ms per ms) of samples (in time order): the median slope between the
// medians of SKEW_BINS consecutive groups, over all pairs at least
// MIN_PAIR_SPAN_MS apart, shrunk by its significance and clamped to
// MAX_SKEW_PPM. Undefined while the samples are too few or too close together.
function skewOf(samples: Sample[]): number | undefined {
  if (samples.length < MIN_SKEW_SAMPLES) return undefined;
  const t0 = samples[0].local;
  if (samples[samples.length - 1].local - t0 < MIN_SKEW_SPAN_MS) return undefined;

  const groupSize = Math.ceil(samples.length / SKEW_BINS);
  const points: [number, number][] = [];
  for (let i = 0; i < samples.length; i += groupSize) {
    const group = samples.slice(i, i + groupSize);
    points.push([group[Math.floor(group.length / 2)].local, median(group.map((s) => s.diff))!]);
  }
  const slopes: number[] = [];
  for (let i = 0; i < points.length; ++i) {
    for (let j = i + 1; j < points.length; ++j) {
      const span = points[j][0] - points[i][0];
      if (span >= MIN_PAIR_SPAN_MS) slopes.push((points[j][1] - points[i][1]) / span);
    }
  }
  const slope = median(slopes);
  if (slope === undefined) return undefined;
  if (slope === 0) return 0;

  // Standard error of a least-squares slope, from the robust (MAD) scatter of
  // the samples around the fitted line
  const meanT = samples.reduce((sum, s) => sum + s.local - t0, 0) / samples.length;
  const residuals = samples.map((s) => s.diff - slope * (s.local - t0));
  const center = median(residuals)!;
  const sigma = 1.4826 * median(residuals.map((r) => Math.abs(r - center)))!;
  const sxx = samples.reduce((sum, s) => sum + (s.local - t0 - meanT) ** 2, 0);
  const variance = (sigma * sigma) / sxx;

  const shrunk = (slope * slope * slope) / (slope * slope + SKEW_SHRINK * variance);
  const max = MAX_SKEW_PPM * 1e-6;
  return Math.min(max, Math.max(-max, shrunk));
}

// Weights by round trip: an offset is off by at most half its round trip's
// excess e over the fastest one, so each gets 1 / (e² + e0²), e0 being the
// excess at the LOW_RTT_DIVISOR quantile. Queued replies count for next to
// nothing, while a link with bounded jitter still uses most of its exchanges.
function rttWeights(samples: Sample[]): number[] {
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  if (rtts.length === 0) return [];
  const min = rtts[0];
  // At least 1 µs, so equal round trips weigh the same
  const e0 = Math.max(rtts[Math.floor((rtts.length - 1) / LOW_RTT_DIVISOR)] - min, 0.001);
  return samples.map((s) => 1 / ((s.rtt - min) ** 2 + e0 * e0));
}

// Syncs the performance clock to the server clock. The performance clock
// keeps running when audio output stalls, unlike the audio clock, so the
// offset stays valid; AudioClock maps audio time onto it.
class TimeProvider {
  reset() {
    this.samples = [];
    this.pending = [];
    this.model = { anchor: 0, offset: 0, skew: 0 };
    this.lastSync = undefined;
    // Replies to requests sent before now may be from another server
    this.pendingRequests.clear();
  }

  // Remember a time request, so only its reply is used for this clock
  trackRequest(id: number) {
    if (this.pendingRequests.size > MAX_PENDING_REQUESTS) this.pendingRequests.clear();
    this.pendingRequests.add(id & 0xffff);
  }

  // Use a time reply if it answers a request sent on the current clock.
  // localMs is when it arrived.
  handleReply(refersTo: number, c2s: number, s2c: number, localMs: number = this.now()): boolean {
    if (!this.pendingRequests.delete(refersTo)) return false;
    this.addSample(localMs, c2s, s2c);
    return true;
  }

  isSynced(): boolean {
    return this.samples.length >= SYNC_MIN_SAMPLES;
  }

  // Add one exchange whose reply arrived at local time localMs: c2s is the
  // server receive time minus the client send time, s2c the client receive
  // time minus the server send time
  addSample(localMs: number, c2s: number, s2c: number) {
    const sample: Sample = { local: localMs, rtt: c2s + s2c, diff: (c2s - s2c) / 2 };

    const sinceLast = this.lastSync === undefined ? 0 : localMs - this.lastSync;
    if (sinceLast > RESET_AFTER_MS) {
      this.samples = [];
      this.pending = [];
    }
    this.lastSync = localMs;

    if (this.samples.length > 0 && contradicts(sample, this.model)) {
      this.pending.push(sample);
      if (this.pending.length >= RESTART_SAMPLES) {
        console.info(
          'Server clock changed by ' + (sample.diff - lineAt(this.model, localMs)).toFixed(1) + ' ms, resyncing',
        );
        this.samples = this.pending;
        this.pending = [];
        this.model = this.fit(localMs);
      }
      return;
    }
    this.pending = [];
    if (this.samples.push(sample) > SKEW_WINDOW) this.samples.shift();

    const fit = this.fit(localMs);
    if (this.samples.length < SETTLED_SAMPLES) {
      this.model = fit;
      return;
    }
    const current = lineAt(this.model, localMs);
    const delta = lineAt(fit, localMs) - current;
    if (Math.abs(delta) > JUMP_MS) {
      this.model = fit;
      return;
    }
    const maxStep = MAX_STEP_MS + MAX_SLEW * sinceLast;
    this.model = {
      anchor: localMs,
      offset: current + Math.min(maxStep, Math.max(-maxStep, delta)),
      skew: fit.skew,
    };
  }

  // Add an exchange whose reply arrives now
  setDiff(c2s: number, s2c: number) {
    this.addSample(this.now(), c2s, s2c);
  }

  // Server minus local clock at local time localMs
  diffAt(localMs: number): number {
    return lineAt(this.model, localMs);
  }

  now() {
    return window.performance.now();
  }

  serverNow() {
    return this.serverTime(this.now());
  }

  serverTime(localTimeMs: number) {
    return localTimeMs + this.diffAt(localTimeMs);
  }

  // Fit the line through the low round trip exchanges, anchored at now
  private fit(now: number): Line {
    const skew = skewOf(lowestRtt(this.samples)) ?? 0;
    const recent = this.samples.slice(-WINDOW);
    const weights = rttWeights(recent);
    const offsets = recent.map((s, i): [number, number] => [s.diff - skew * (s.local - now), weights[i]]);
    return { anchor: now, offset: weightedMedian(offsets) ?? 0, skew };
  }

  // The last SKEW_WINDOW exchanges, oldest first
  samples: Sample[] = [];
  // Exchanges held back while they contradict the estimate
  pending: Sample[] = [];
  // The estimate handed out, following the fit of samples
  model: Line = { anchor: 0, offset: 0, skew: 0 };
  lastSync: number | undefined = undefined;
  pendingRequests: Set<number> = new Set<number>();
}

export { TimeProvider };
