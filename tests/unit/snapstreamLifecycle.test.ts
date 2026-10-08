import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '../helpers/fakeWebSocket';
import { quietConsole } from '../helpers/snapControl';

// A Web Audio stand-in that records what SnapStream schedules and closes
const audio = vi.hoisted(() => {
  class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    sampleRate: number;
    currentTime = 1;
    baseLatency = 0;
    closed = false;
    sources: { started: boolean; stopped: boolean; when?: number }[] = [];
    destination = {};

    constructor(options?: { sampleRate?: number }) {
      this.sampleRate = options?.sampleRate ?? 48000;
      FakeAudioContext.instances.push(this);
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
    createBuffer(_channels: number, length: number) {
      const data = [new Float32Array(length), new Float32Array(length)];
      return { length, getChannelData: (i: number) => data[i] };
    }
    createBufferSource() {
      const source = {
        started: false,
        stopped: false,
        buffer: null,
        onended: null,
        connect() {},
        when: undefined as number | undefined,
        start(when: number) {
          source.started = true;
          source.when = when;
        },
        stop() {
          source.stopped = true;
        },
      };
      this.sources.push(source);
      return source;
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      return Promise.resolve();
    }
    // Sources started and not stopped
    playing() {
      return this.sources.filter((source) => source.started && !source.stopped).length;
    }
  }
  return { FakeAudioContext };
});
vi.mock('standardized-audio-context', () => ({ AudioContext: audio.FakeAudioContext }));

const { HelloMessage, SnapStream } = await import('../../src/snapstream');

// A CodecHeader message for 16 bit stereo PCM at the given rate
function pcmCodecHeader(rate: number): ArrayBuffer {
  const codec = new TextEncoder().encode('pcm');
  const wav = new DataView(new ArrayBuffer(44));
  wav.setUint16(22, 2, true);
  wav.setUint32(24, rate, true);
  wav.setUint16(34, 16, true);
  const buffer = new ArrayBuffer(26 + 4 + codec.length + 4 + 44);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true);
  view.setUint32(26, codec.length, true);
  new Uint8Array(buffer, 30).set(codec);
  view.setUint32(30 + codec.length, 44, true);
  new Uint8Array(buffer, 34 + codec.length).set(new Uint8Array(wav.buffer));
  return buffer;
}

describe('SnapStream lifecycle', () => {
  beforeEach(() => {
    quietConsole();
    FakeWebSocket.reset();
    audio.FakeAudioContext.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // SnapStream only uses options on browsers with a native AudioContext
    vi.stubGlobal('AudioContext', audio.FakeAudioContext);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function start() {
    const stream = new SnapStream('ws://snapserver:1780');
    const ws = FakeWebSocket.latest();
    ws.open();
    return { stream, ws };
  }

  function receive(ws: FakeWebSocket, buffer: ArrayBuffer) {
    ws.onmessage?.({ data: buffer } as any);
  }

  it('connects to the stream endpoint and says hello', () => {
    const { ws } = start();
    expect(ws.url).toBe('ws://snapserver:1780/stream');

    // Message type 5 is Hello
    expect(new DataView(ws.sent[0]).getUint16(0, true)).toBe(5);
    const hello = new HelloMessage(ws.sent[0]);
    expect(hello.clientName).toBe('snapweb');
    expect(hello.version).toMatch(/^\d+\.\d+/);
  });

  it('keeps one playback chain across repeated codec headers', () => {
    const { ws } = start();
    const ctx = audio.FakeAudioContext.instances[0];
    receive(ws, pcmCodecHeader(48000));
    expect(ctx.playing()).toBe(3);

    // e.g. the group switched to another stream with the same format
    receive(ws, pcmCodecHeader(48000));
    expect(ctx.playing()).toBe(3);
  });

  it('closes the audio context when the sample rate changes', () => {
    const { ws } = start();
    receive(ws, pcmCodecHeader(44100));

    expect(audio.FakeAudioContext.instances).toHaveLength(2);
    expect(audio.FakeAudioContext.instances[0].closed).toBe(true);
    expect(audio.FakeAudioContext.instances[1].sampleRate).toBe(44100);
  });

  it('restarts playback when it fell behind the audio clock', () => {
    const { ws } = start();
    const ctx = audio.FakeAudioContext.instances[0];
    receive(ws, pcmCodecHeader(48000));
    // Three 80 ms buffers from 1.1 s, then the main thread stalled
    ctx.currentTime = 5;
    const first = ctx.sources[0] as any;
    first.onended();

    expect(ctx.sources[3].when).toBeCloseTo(5.1);
  });

  it('releases the audio context and socket on stop', () => {
    const { stream, ws } = start();
    receive(ws, pcmCodecHeader(48000));
    stream.stop();

    const ctx = audio.FakeAudioContext.instances[0];
    expect(ctx.closed).toBe(true);
    expect(ctx.playing()).toBe(0);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('does not reconnect after stop while a reconnect is pending', () => {
    const { stream, ws } = start();
    ws.drop();
    stream.stop();
    vi.advanceTimersByTime(5000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('ignores messages after stop', () => {
    const { stream, ws } = start();
    const onmessage = ws.onmessage;
    stream.stop();
    onmessage?.({ data: pcmCodecHeader(48000) } as any);

    expect(audio.FakeAudioContext.instances[0].playing()).toBe(0);
  });

  it('reconnects after the connection drops', () => {
    const { ws } = start();
    ws.drop();
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
