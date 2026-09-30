import { describe, expect, it, vi } from 'vitest';
import { HelloMessage, JsonMessage, SnapStream, TimeMessage, TimeProvider, Tv } from '../../src/snapstream';

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
    msg.sent = new Tv(10, 20);
    msg.latency = new Tv(1, 500000);
    const parsed = new TimeMessage(msg.serialize());

    expect(parsed.type).toBe(4);
    expect(parsed.id).toBe(7);
    expect(parsed.latency).toEqual(new Tv(1, 500000));
    // serialize writes sent first, deserialize reads it into received
    expect(parsed.received).toEqual(new Tv(10, 20));
  });
});

describe('TimeProvider', () => {
  it('uses the numeric median of the clock offsets', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    // offsets are (c2s - s2c) / 2
    for (const offset of [2, 10, -5, 100, 3])
      provider.setDiff(offset * 2, 0);

    // numeric order: -5, 2, 3, 10, 100 (string order would pick 100)
    expect(provider.diff).toBe(3);
    expect(provider.serverTime(1000)).toBe(1003);
  });

  it('keeps only the last 100 offsets', () => {
    const provider = new TimeProvider();
    vi.spyOn(provider, 'now').mockReturnValue(1000);
    for (let i = 0; i < 150; ++i)
      provider.setDiff(i * 2, 0);

    expect(provider.diffBuffer).toHaveLength(100);
    expect(provider.diffBuffer[0]).toBe(50);
    expect(provider.diff).toBe(100);
  });

  it('resets while the clock is not running', () => {
    const provider = new TimeProvider();
    const now = vi.spyOn(provider, 'now').mockReturnValue(1000);
    provider.setDiff(20, 0);
    expect(provider.diff).toBe(10);

    now.mockReturnValue(0);
    provider.setDiff(40, 0);
    expect(provider.diff).toBe(0);
    expect(provider.diffBuffer).toHaveLength(0);
  });

  it('prefers the audio output timestamp over currentTime', () => {
    const provider = new TimeProvider();
    provider.setAudioContext({ currentTime: 2, getOutputTimestamp: () => ({ contextTime: 1.5 }) } as any);
    expect(provider.now()).toBe(1500);

    provider.setAudioContext({ currentTime: 2 } as any);
    expect(provider.now()).toBe(2000);
    expect(provider.nowSec()).toBe(2);
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
