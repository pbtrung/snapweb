import { describe, expect, it, vi } from 'vitest';
import {
  AudioStream,
  HelloMessage,
  JsonMessage,
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

  it('ignores samples while the clock is not running, keeping earlier ones', () => {
    const provider = new TimeProvider();
    const now = vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.setDiff(20, 0);
    expect(provider.diff).toBe(10);

    now.mockReturnValue(0);
    expect(provider.isRunning()).toBe(false);
    provider.setDiff(40, 0);
    expect(provider.diff).toBe(10);
    expect(provider.diffBuffer).toEqual([10]);
  });

  it('uses the audio context clock that buffers are scheduled on', () => {
    const provider = new TimeProvider();
    // getOutputTimestamp would already include the output latency
    provider.setAudioContext({ currentTime: 2, getOutputTimestamp: () => ({ contextTime: 1.5 }) } as any);
    expect(provider.now()).toBe(2000);
    expect(provider.nowSec()).toBe(2);
  });

  it('falls back to performance.now without an audio context', () => {
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

  it('drops replies to requests sent on the previous clock', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.trackRequest(1);
    provider.setDiff(20, 0);

    provider.setAudioContext({ currentTime: 1 } as any);
    expect(provider.diffBuffer).toEqual([]);
    expect(provider.isSynced()).toBe(false);
    expect(provider.handleReply(1, 20, 0)).toBe(false);
  });
});

describe('SnapStream.getClientId', () => {
  it('creates a UUID once and persists it', () => {
    window.localStorage.clear();
    const id = SnapStream.getClientId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(SnapStream.getClientId()).toBe(id);
  });

  it('falls back to a Math.random UUID without crypto.randomUUID', () => {
    window.localStorage.clear();
    vi.stubGlobal('crypto', {});
    expect(SnapStream.getClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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
});
