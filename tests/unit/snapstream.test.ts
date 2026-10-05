import { describe, expect, it, vi } from 'vitest';
import {
  AudioClock,
  AudioStream,
  HelloMessage,
  JsonMessage,
  PcmChunkMessage,
  SampleFormat,
  SnapStream,
  TimeMessage,
  TimeProvider,
  Tv,
} from '../../src/snapstream';

describe('Tv', () => {
  it('converts to and from milliseconds', () => {
    const tv = new Tv(0, 0);
    tv.setMilliseconds(1234.5);
    expect(tv.sec).toBe(1);
    expect(tv.usec).toBe(234500);
    expect(tv.getMilliseconds()).toBe(1234.5);
  });
});

describe('JsonMessage', () => {
  it('round-trips ASCII json', () => {
    const msg = new JsonMessage();
    msg.json = { a: 1, b: 'two' };
    const copy = new JsonMessage(msg.serialize());
    expect(copy.json).toEqual({ a: 1, b: 'two' });
  });

  it('round-trips non-ASCII json by UTF-8 byte length', () => {
    const msg = new JsonMessage();
    msg.json = { name: 'Küche', emoji: '🔊', text: 'Ωmega' };
    const buffer = msg.serialize();

    const jsonBytes = new TextEncoder().encode(JSON.stringify(msg.json)).length;
    expect(new DataView(buffer).getUint32(26, true)).toBe(jsonBytes);
    expect(buffer.byteLength).toBe(30 + jsonBytes);
    expect(new JsonMessage(buffer).json).toEqual(msg.json);
  });
});

describe('HelloMessage', () => {
  it('serializes its fields and parses them back', () => {
    const hello = new HelloMessage();
    hello.mac = '00:00:00:00:00:00';
    hello.hostname = 'Wohnzimmer Küche';
    hello.os = 'Linux';
    hello.uniqueId = 'abc';
    hello.instance = 3;
    const buffer = hello.serialize();

    expect(new DataView(buffer).getUint16(0, true)).toBe(5);
    const parsed = new HelloMessage(buffer);
    expect(parsed.hostname).toBe('Wohnzimmer Küche');
    expect(parsed.uniqueId).toBe('abc');
    expect(parsed.instance).toBe(3);
    expect(parsed.arch).toBe('web');
    expect(parsed.snapStreamProtocolVersion).toBe(2);
  });
});

describe('TimeMessage', () => {
  it('round-trips the latency and header timestamps', () => {
    const msg = new TimeMessage();
    msg.id = 7;
    msg.refersTo = 3;
    msg.sent = new Tv(10, 20);
    msg.received = new Tv(30, 40);
    msg.latency = new Tv(1, 500000);
    const parsed = new TimeMessage(msg.serialize());

    expect(parsed.type).toBe(4);
    expect(parsed.id).toBe(7);
    expect(parsed.refersTo).toBe(3);
    expect(parsed.latency).toEqual(new Tv(1, 500000));
    expect(parsed.sent).toEqual(new Tv(10, 20));
    expect(parsed.received).toEqual(new Tv(30, 40));
  });

  it('reads the header in Snapcast wire order: sent, then received', () => {
    const buffer = new ArrayBuffer(34);
    const view = new DataView(buffer);
    view.setUint16(0, 4, true);
    view.setInt32(6, 5, true);
    view.setInt32(14, 6, true);
    const parsed = new TimeMessage(buffer);

    expect(parsed.sent.sec).toBe(5);
    expect(parsed.received.sec).toBe(6);
  });
});

describe('TimeProvider', () => {
  it('uses the numeric median of the clock offsets', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    // offsets are (c2s - s2c) / 2
    for (const offset of [2, 10, -5, 100, 3]) provider.setDiff(offset * 2, 0);

    // numeric order: -5, 2, 3, 10, 100 (string order would pick 100)
    expect(provider.diff).toBe(3);
    expect(provider.serverTime(1000)).toBe(1003);
  });

  it('keeps only the last 100 offsets', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    for (let i = 0; i < 150; ++i) provider.setDiff(i * 2, 0);

    expect(provider.diffBuffer).toHaveLength(100);
    expect(provider.diffBuffer[0]).toBe(50);
    expect(provider.diff).toBe(100);
  });

  it('uses the performance clock, which keeps running when audio stalls', () => {
    vi.spyOn(window.performance, 'now').mockReturnValue(1234);
    expect(new TimeProvider().now()).toBe(1234);
  });

  it('is synced after three samples', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.setDiff(2, 0);
    provider.setDiff(2, 0);
    expect(provider.isSynced()).toBe(false);
    provider.setDiff(2, 0);
    expect(provider.isSynced()).toBe(true);
  });

  it('only uses replies to tracked requests, once', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.trackRequest(5);

    expect(provider.handleReply(6, 20, 0)).toBe(false);
    expect(provider.handleReply(5, 20, 0)).toBe(true);
    expect(provider.handleReply(5, 40, 0)).toBe(false);
    expect(provider.diffBuffer).toEqual([10]);
  });

  it('matches request ids the way they wrap on the wire', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.trackRequest(65536 + 7);
    expect(provider.handleReply(7, 20, 0)).toBe(true);
  });

  it('drops replies to requests sent before a reset', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.trackRequest(1);
    provider.setDiff(20, 0);

    provider.reset();
    expect(provider.diffBuffer).toEqual([]);
    expect(provider.isSynced()).toBe(false);
    expect(provider.handleReply(1, 20, 0)).toBe(false);
  });
});

describe('AudioClock', () => {
  // An audio context whose output timestamp offset is set per test
  function fakeContext() {
    return {
      currentTime: 0,
      baseLatency: 0,
      outputLatency: 0,
      timestamp: undefined as AudioTimestamp | undefined,
      getOutputTimestamp() {
        return this.timestamp;
      },
    };
  }

  // Outputs at contextTime 10 s, heard at performance time 10000 + offset ms
  function heardWithOffset(offset: number): AudioTimestamp {
    return { contextTime: 10, performanceTime: 10000 + offset };
  }

  it('is not mapped until the audio clock runs', () => {
    const clock = new AudioClock(fakeContext() as any);
    expect(clock.toPerformanceTime(1)).toBeNaN();
  });

  it('maps context time to the performance time it is heard at', () => {
    const ctx = fakeContext();
    ctx.timestamp = heardWithOffset(500);
    expect(new AudioClock(ctx as any).toPerformanceTime(12)).toBe(12500);
  });

  it('falls back to currentTime and the output latency without output timestamps', () => {
    const ctx = fakeContext();
    ctx.currentTime = 10;
    ctx.outputLatency = 0.2;
    vi.spyOn(window.performance, 'now').mockReturnValue(10300);
    // Played now at 10 s, heard 200 ms later, at 10500
    expect(new AudioClock(ctx as any).toPerformanceTime(10)).toBeCloseTo(10500);
  });

  it('uses the median offset, ignoring jitter', () => {
    const ctx = fakeContext();
    const clock = new AudioClock(ctx as any);
    for (const offset of [500, 503, 498, 501, 499]) {
      ctx.timestamp = heardWithOffset(offset);
      clock.toPerformanceTime(0);
    }
    expect(clock.offset).toBe(500);
  });

  it('ignores a single stray offset', () => {
    const ctx = fakeContext();
    const clock = new AudioClock(ctx as any);
    for (const offset of [500, 500, 900, 500]) {
      ctx.timestamp = heardWithOffset(offset);
      clock.toPerformanceTime(0);
    }
    expect(clock.offset).toBe(500);
    expect(clock.offsets).toEqual([500, 500, 500]);
  });

  it('follows a jump at once when several offsets in a row agree', () => {
    const ctx = fakeContext();
    const clock = new AudioClock(ctx as any);
    for (let i = 0; i < 20; ++i) {
      ctx.timestamp = heardWithOffset(500);
      clock.toPerformanceTime(0);
    }
    // The audio clock paused for a second
    for (const offset of [1500, 1502, 1499]) {
      ctx.timestamp = heardWithOffset(offset);
      clock.toPerformanceTime(0);
    }
    expect(clock.offset).toBe(1500);
    expect(clock.offsets).toEqual([1500, 1502, 1499]);
  });

  it('keeps only the last 25 offsets', () => {
    const ctx = fakeContext();
    const clock = new AudioClock(ctx as any);
    for (let i = 0; i < 40; ++i) {
      ctx.timestamp = heardWithOffset(500 + i * 0.1);
      clock.toPerformanceTime(0);
    }
    expect(clock.offsets).toHaveLength(25);
    expect(clock.offsets[0]).toBeCloseTo(501.5);
  });
});

describe('SnapStream.getClientId', () => {
  it('creates a UUID once and persists it', () => {
    window.localStorage.clear();
    const id = SnapStream.getClientId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(SnapStream.getClientId()).toBe(id);
  });
});

describe('AudioStream', () => {
  function fakeBuffer(frames: number) {
    const channels = [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)];
    return { length: frames, getChannelData: (i: number) => channels[i], channels };
  }

  it('plays silence and keeps its chunks until the clock is synced', () => {
    const provider = new TimeProvider();
    const stream = new AudioStream(provider, new SampleFormat(), 1000);
    const chunk = { startMs: () => 0 } as any;
    stream.chunks.push(chunk);
    const buffer = fakeBuffer(4);
    stream.getNextBuffer(buffer as any, 5000);

    expect(Array.from(buffer.channels[0])).toEqual([0, 0, 0, 0]);
    expect(Array.from(buffer.channels[1])).toEqual([0, 0, 0, 0]);
    expect(stream.chunks).toEqual([chunk]);
    expect(stream.chunk).toBeUndefined();
  });

  it('plays silence and keeps its chunks until the audio clock runs', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'isSynced').mockReturnValue(true);
    const stream = new AudioStream(provider, new SampleFormat(), 1000);
    const chunk = { startMs: () => 0 } as any;
    stream.chunks.push(chunk);
    const buffer = fakeBuffer(4);
    stream.getNextBuffer(buffer as any, NaN);

    expect(Array.from(buffer.channels[0])).toEqual([0, 0, 0, 0]);
    expect(stream.chunks).toEqual([chunk]);
  });
});

// A wire chunk with the given stereo 16 bit samples, starting at timestampMs
function wireChunk(timestampMs: number, samples: number[], sampleFormat: SampleFormat) {
  const buffer = new ArrayBuffer(38 + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint16(0, 2, true);
  const ts = new Tv(0, 0);
  ts.setMilliseconds(timestampMs);
  view.setInt32(26, ts.sec, true);
  view.setInt32(30, ts.usec, true);
  view.setUint32(34, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(38 + i * 2, sample, true));
  return new PcmChunkMessage(buffer, sampleFormat);
}

describe('AudioStream playback', () => {
  // 1 frame per ms keeps the arithmetic readable
  function sampleFormat() {
    const format = new SampleFormat();
    format.rate = 1000;
    return format;
  }

  function syncedProvider() {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'isSynced').mockReturnValue(true);
    vi.spyOn(provider, 'now').mockReturnValue(50000);
    return provider;
  }

  function fakeBuffer(frames: number) {
    const channels = [new Float32Array(frames), new Float32Array(frames)];
    return { length: frames, getChannelData: (i: number) => channels[i], channels };
  }

  // Frame n carries the sample value n * 1000
  function frames(count: number) {
    return Array.from({ length: count }, (_, i) => [1000 * (i + 1), 1000 * (i + 1)]).flat();
  }

  it('catches up by dropping frames when slightly late', () => {
    const format = sampleFormat();
    const stream = new AudioStream(syncedProvider(), format, 1000);
    // 1.5 ms late: read 6 frames into 4, dropping 2 of them
    stream.addChunk(wireChunk(50000 - 1.5, frames(20), format));
    const buffer = fakeBuffer(4);
    stream.getNextBuffer(buffer as any, 50000);

    expect(Array.from(buffer.channels[0]).map((sample) => Math.round((sample * 32768) / 1000))).toEqual([1, 3, 5, 6]);
    expect(stream.chunk!.idx).toBe(6);
  });

  it('slows down by repeating frames when slightly early', () => {
    const format = sampleFormat();
    const stream = new AudioStream(syncedProvider(), format, 1000);
    // 1.5 ms early: read 2 frames into 4, playing each twice
    stream.addChunk(wireChunk(50000 + 1.5, frames(20), format));
    const buffer = fakeBuffer(4);
    stream.getNextBuffer(buffer as any, 50000);

    expect(Array.from(buffer.channels[0]).map((sample) => Math.round((sample * 32768) / 1000))).toEqual([1, 1, 2, 2]);
    expect(stream.chunk!.idx).toBe(2);
  });

  it('seeks into the chunk when far behind', () => {
    const format = sampleFormat();
    const stream = new AudioStream(syncedProvider(), format, 1000);
    // 10 ms late: skip 10 frames, then play from frame 11
    stream.addChunk(wireChunk(50000 - 10, frames(20), format));
    const buffer = fakeBuffer(4);
    stream.getNextBuffer(buffer as any, 50000);

    expect(Array.from(buffer.channels[0]).map((sample) => Math.round((sample * 32768) / 1000))).toEqual([
      11, 12, 13, 14,
    ]);
  });

  it('pads with silence when far ahead', () => {
    const format = sampleFormat();
    const stream = new AudioStream(syncedProvider(), format, 1000);
    // The chunk starts 6 ms into a 10 ms buffer, beyond the 5 ms hard sync threshold
    stream.addChunk(wireChunk(50000 + 6, frames(20), format));
    const buffer = fakeBuffer(10);
    stream.getNextBuffer(buffer as any, 50000);

    expect(Array.from(buffer.channels[0]).map((sample) => Math.round((sample * 32768) / 1000))).toEqual([
      0, 0, 0, 0, 0, 0, 1, 2, 3, 4,
    ]);
  });

  it('bounds the queue by the newest chunk before the clock is synced', () => {
    const format = sampleFormat();
    const stream = new AudioStream(new TimeProvider(), format, 1000);
    stream.addChunk(wireChunk(0, [0, 0], format));
    stream.addChunk(wireChunk(3000, [0, 0], format));
    expect(stream.chunks).toHaveLength(2);

    // 6001 ms newer than the first chunk, beyond 5000 ms + the 1000 ms buffer
    stream.addChunk(wireChunk(6001, [0, 0], format));
    expect(stream.chunks.map((chunk) => chunk.timestamp.getMilliseconds())).toEqual([3000, 6001]);
  });
});
