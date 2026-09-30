import Flac from 'libflacjs/dist/libflac.js';
import { getClientId } from './config.ts';
import {
  AudioContext,
  IAudioBuffer,
  IAudioContext,
  IAudioBufferSourceNode,
  IGainNode,
} from 'standardized-audio-context';
import { OpusDecoder as WasmOpusDecoder, OpusDecoderSampleRate } from 'opus-decoder';

// Snapcast binary protocol: every message starts with a 26 byte header
const HEADER_SIZE = 26;

enum MessageType {
  CodecHeader = 1,
  WireChunk = 2,
  ServerSettings = 3,
  Time = 4,
  Hello = 5,
}

// Playback
const BUFFER_DURATION_MS = 80; // length of each scheduled audio buffer
const AUDIO_BUFFER_COUNT = 3; // buffers in flight
const PLAY_START_DELAY_S = 0.1; // headroom before the first buffer plays
const HARD_SYNC_THRESHOLD_MS = 5; // beyond this, seek instead of adjusting frames
const SOFT_SYNC_THRESHOLD_MS = 0.1; // below this, play as is
const MAX_CHUNK_AGE_MS = 5000; // beyond the server buffer, chunks are dropped

// Time sync
const SYNC_INTERVAL_MS = 1000;
const SYNC_BURST_COUNT = 10; // requests sent right after the audio clock starts
const SYNC_BURST_SPACING_MS = 25;
const SYNC_WINDOW = 100; // offsets the median is taken over
const SYNC_MIN_SAMPLES = 3; // enough for the median to ignore one outlier

const RECONNECT_DELAY_MS = 1000;

declare global {
  // declare window.webkitAudioContext for the ts compiler
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// declare AudioContext.outputLatency for the ts compiler
interface IAudioContextPatched extends IAudioContext {
  readonly outputLatency: number;
}

class AudioContextPatched extends AudioContext implements IAudioContextPatched {
  get outputLatency(): number {
    const ctx = (<any>this)._nativeAudioContext;
    if (ctx && ctx.outputLatency !== undefined) {
      return ctx.outputLatency;
    }
    return 0;
  }
}

function getChromeVersion(): number | null {
  const raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
  return raw ? parseInt(raw[2]) : null;
}

class Tv {
  constructor(sec: number, usec: number) {
    this.sec = sec;
    this.usec = usec;
  }

  setMilliseconds(ms: number) {
    this.sec = Math.floor(ms / 1000);
    this.usec = Math.floor(ms * 1000) % 1000000;
  }

  getMilliseconds(): number {
    return this.sec * 1000 + this.usec / 1000;
  }

  sec: number = 0;
  usec: number = 0;
}

class BaseMessage {
  deserialize(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    this.type = view.getUint16(0, true);
    this.id = view.getUint16(2, true);
    this.refersTo = view.getUint16(4, true);
    this.sent = new Tv(view.getInt32(6, true), view.getInt32(10, true));
    this.received = new Tv(view.getInt32(14, true), view.getInt32(18, true));
    this.size = view.getUint32(22, true);
  }

  serialize(): ArrayBuffer {
    this.size = HEADER_SIZE + this.getSize();
    const buffer = new ArrayBuffer(this.size);
    const view = new DataView(buffer);
    view.setUint16(0, this.type, true);
    view.setUint16(2, this.id, true);
    view.setUint16(4, this.refersTo, true);
    view.setInt32(6, this.sent.sec, true);
    view.setInt32(10, this.sent.usec, true);
    view.setInt32(14, this.received.sec, true);
    view.setInt32(18, this.received.usec, true);
    view.setUint32(22, this.size, true);
    return buffer;
  }

  getSize() {
    return 0;
  }

  type: number = 0;
  id: number = 0;
  refersTo: number = 0;
  received: Tv = new Tv(0, 0);
  sent: Tv = new Tv(0, 0);
  size: number = 0;
}

class CodecMessage extends BaseMessage {
  constructor(buffer?: ArrayBuffer) {
    super();
    if (buffer) this.deserialize(buffer);
    this.type = MessageType.CodecHeader;
  }

  deserialize(buffer: ArrayBuffer) {
    super.deserialize(buffer);
    const view = new DataView(buffer);
    const codecSize = view.getUint32(HEADER_SIZE, true);
    const codecStart = HEADER_SIZE + 4;
    this.codec = new TextDecoder('utf-8').decode(buffer.slice(codecStart, codecStart + codecSize));
    const payloadSize = view.getUint32(codecStart + codecSize, true);
    const payloadStart = codecStart + codecSize + 4;
    this.payload = buffer.slice(payloadStart, payloadStart + payloadSize);
  }

  codec: string = '';
  payload: ArrayBuffer = new ArrayBuffer(0);
}

class TimeMessage extends BaseMessage {
  constructor(buffer?: ArrayBuffer) {
    super();
    if (buffer) this.deserialize(buffer);
    this.type = MessageType.Time;
  }

  deserialize(buffer: ArrayBuffer) {
    super.deserialize(buffer);
    const view = new DataView(buffer);
    this.latency = new Tv(view.getInt32(HEADER_SIZE, true), view.getInt32(HEADER_SIZE + 4, true));
  }

  serialize(): ArrayBuffer {
    const buffer = super.serialize();
    const view = new DataView(buffer);
    view.setInt32(HEADER_SIZE, this.latency.sec, true);
    view.setInt32(HEADER_SIZE + 4, this.latency.usec, true);
    return buffer;
  }

  getSize() {
    return 8;
  }

  latency: Tv = new Tv(0, 0);
}

class JsonMessage extends BaseMessage {
  constructor(buffer?: ArrayBuffer) {
    super();
    // Subclasses parse in their own constructor, after their fields are
    // initialized; parsing here would be overwritten by those initializers
    if (buffer && new.target === JsonMessage) this.deserialize(buffer);
  }

  deserialize(buffer: ArrayBuffer) {
    super.deserialize(buffer);
    const size = new DataView(buffer).getUint32(HEADER_SIZE, true);
    this.json = JSON.parse(new TextDecoder().decode(buffer.slice(HEADER_SIZE + 4, HEADER_SIZE + 4 + size)));
  }

  serialize(): ArrayBuffer {
    // The size is the UTF-8 byte length, not the UTF-16 string length,
    // otherwise non-ASCII payloads get truncated
    this.encoded = new TextEncoder().encode(JSON.stringify(this.json));
    const buffer = super.serialize();
    new DataView(buffer).setUint32(HEADER_SIZE, this.encoded.length, true);
    new Uint8Array(buffer, HEADER_SIZE + 4).set(this.encoded);
    return buffer;
  }

  getSize() {
    this.encoded ??= new TextEncoder().encode(JSON.stringify(this.json));
    return this.encoded.length + 4;
  }

  json: any;
  private encoded?: Uint8Array;
}

class HelloMessage extends JsonMessage {
  constructor(buffer?: ArrayBuffer) {
    super(buffer);
    if (buffer) this.deserialize(buffer);
    this.type = MessageType.Hello;
  }

  deserialize(buffer: ArrayBuffer) {
    super.deserialize(buffer);
    this.mac = this.json['MAC'];
    this.hostname = this.json['HostName'];
    this.version = this.json['Version'];
    this.clientName = this.json['ClientName'];
    this.os = this.json['OS'];
    this.arch = this.json['Arch'];
    this.instance = this.json['Instance'];
    this.uniqueId = this.json['ID'];
    this.snapStreamProtocolVersion = this.json['SnapStreamProtocolVersion'];
  }

  serialize(): ArrayBuffer {
    this.json = {
      MAC: this.mac,
      HostName: this.hostname,
      Version: this.version,
      ClientName: this.clientName,
      OS: this.os,
      Arch: this.arch,
      Instance: this.instance,
      ID: this.uniqueId,
      SnapStreamProtocolVersion: this.snapStreamProtocolVersion,
    };
    return super.serialize();
  }

  mac: string = '';
  hostname: string = '';
  version: string = import.meta.env.VITE_APP_VERSION;
  clientName = import.meta.env.VITE_APP_NAME;
  os: string = '';
  arch: string = 'web';
  instance: number = 1;
  uniqueId: string = '';
  snapStreamProtocolVersion: number = 2;
}

class ServerSettingsMessage extends JsonMessage {
  constructor(buffer?: ArrayBuffer) {
    super(buffer);
    if (buffer) this.deserialize(buffer);
    this.type = MessageType.ServerSettings;
  }

  deserialize(buffer: ArrayBuffer) {
    super.deserialize(buffer);
    this.bufferMs = this.json['bufferMs'];
    this.latency = this.json['latency'];
    this.volumePercent = this.json['volume'];
    this.muted = this.json['muted'];
  }

  serialize(): ArrayBuffer {
    this.json = { bufferMs: this.bufferMs, latency: this.latency, volume: this.volumePercent, muted: this.muted };
    return super.serialize();
  }

  bufferMs: number = 0;
  latency: number = 0;
  volumePercent: number = 0;
  muted: boolean = false;
}

// A wire chunk: a timestamp and encoded audio, which the decoder replaces
// with PCM in place
class PcmChunkMessage extends BaseMessage {
  constructor(buffer: ArrayBuffer, sampleFormat: SampleFormat) {
    super();
    this.deserialize(buffer);
    this.sampleFormat = sampleFormat;
    this.type = MessageType.WireChunk;
  }

  deserialize(buffer: ArrayBuffer) {
    super.deserialize(buffer);
    const view = new DataView(buffer);
    this.timestamp = new Tv(view.getInt32(HEADER_SIZE, true), view.getInt32(HEADER_SIZE + 4, true));
    // The payload size field at HEADER_SIZE + 8 is followed by the payload
    this.payload = buffer.slice(HEADER_SIZE + 12);
  }

  readFrames(frames: number): ArrayBuffer {
    const frameSize = this.sampleFormat.frameSize();
    const frameCnt = Math.min(frames, this.getFrameCount() - this.idx);
    const begin = this.idx * frameSize;
    this.idx += frameCnt;
    return this.payload.slice(begin, begin + frameCnt * frameSize);
  }

  getFrameCount(): number {
    return this.payloadSize() / this.sampleFormat.frameSize();
  }

  isEndOfChunk(): boolean {
    return this.idx >= this.getFrameCount();
  }

  // Server time of the next unread frame
  startMs(): number {
    return this.timestamp.getMilliseconds() + 1000 * (this.idx / this.sampleFormat.rate);
  }

  // Duration of the unread frames
  duration(): number {
    return 1000 * ((this.getFrameCount() - this.idx) / this.sampleFormat.rate);
  }

  payloadSize(): number {
    return this.payload.byteLength;
  }

  clearPayload(): void {
    this.payload = new ArrayBuffer(0);
  }

  addPayload(buffer: ArrayBuffer) {
    const payload = new Uint8Array(this.payload.byteLength + buffer.byteLength);
    payload.set(new Uint8Array(this.payload));
    payload.set(new Uint8Array(buffer), this.payload.byteLength);
    this.payload = payload.buffer;
  }

  timestamp: Tv = new Tv(0, 0);
  payload: ArrayBuffer = new ArrayBuffer(0);
  idx: number = 0;
  sampleFormat: SampleFormat;
}

// Queues decoded chunks and fills audio buffers from them, in sync with the
// server clock
class AudioStream {
  constructor(
    public _timeProvider: TimeProvider,
    public _sampleFormat: SampleFormat,
    public _bufferMs: number,
  ) {}

  chunks: Array<PcmChunkMessage> = new Array<PcmChunkMessage>();
  chunk?: PcmChunkMessage = undefined;

  addChunk(chunk: PcmChunkMessage) {
    this.chunks.push(chunk);
    // Before the clock is synced the server time is unknown, so bound the
    // queue relative to the newest chunk instead
    const newestMs = chunk.timestamp.getMilliseconds();
    while (this.chunks.length > 0) {
      const reference = this._timeProvider.isSynced() ? this._timeProvider.serverNow() : newestMs;
      if (reference - this.chunks[0].timestamp.getMilliseconds() <= MAX_CHUNK_AGE_MS + this._bufferMs) break;
      this.chunks.shift();
    }
  }

  // Skip or pad so the current chunk starts at the play time. Returns the
  // number of silent frames written at the start of left and right.
  private hardSync(serverPlayTimeMs: number, left: Float32Array, right: Float32Array): number {
    let age = serverPlayTimeMs - this.chunk!.startMs();
    while (this.chunk && age > this.chunk.duration()) {
      console.debug('Chunk too old, dropping (age: ' + age.toFixed(2) + ' ms)');
      this.chunk = this.chunks.shift();
      if (this.chunk) age = serverPlayTimeMs - this.chunk.startMs();
    }
    if (!this.chunk) return 0;
    if (age > 0) {
      this.chunk.readFrames(Math.floor(age * this.chunk.sampleFormat.msRate()));
      return 0;
    }
    const silentFrames = Math.min(left.length, Math.floor(-age * this.chunk.sampleFormat.msRate()));
    left.fill(0, 0, silentFrames);
    right.fill(0, 0, silentFrames);
    return silentFrames;
  }

  getNextBuffer(buffer: IAudioBuffer, playTimeMs: number) {
    const frames = buffer.length;
    if (!this._timeProvider.isSynced()) {
      // Without a server time we can't tell which chunk is due, so play
      // silence instead of dropping or skipping chunks
      buffer.getChannelData(0).fill(0);
      buffer.getChannelData(1).fill(0);
      return;
    }
    this.chunk ??= this.chunks.shift();

    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    let read = 0;
    let pos = 0;
    const serverPlayTimeMs = this._timeProvider.serverTime(playTimeMs);
    if (this.chunk) {
      let age = serverPlayTimeMs - this.chunk.startMs();
      const reqChunkDuration = frames / this._sampleFormat.msRate();
      // A chunk that starts after this whole buffer leaves it silent
      if (age >= -reqChunkDuration) {
        if (Math.abs(age) > HARD_SYNC_THRESHOLD_MS) {
          read = pos = this.hardSync(serverPlayTimeMs, left, right);
          age = 0;
        }

        // Soft sync: read |addFrames| frames more (late) or fewer (early)
        // than the buffer holds, dropping or duplicating one frame every
        // everyN frames. read already counts the silence from a hard sync.
        let addFrames = 0;
        if (age > SOFT_SYNC_THRESHOLD_MS) addFrames = Math.ceil(age);
        else if (age < -SOFT_SYNC_THRESHOLD_MS) addFrames = Math.floor(age);
        const readFrames = frames + addFrames;
        const everyN = addFrames !== 0 ? Math.ceil(readFrames / (Math.abs(addFrames) + 1)) : 0;
        let corrections = 0;

        while (read < readFrames && this.chunk) {
          const pcmChunk = this.chunk;
          const pcmBuffer = pcmChunk.readFrames(readFrames - read);
          // Signed PCM peaks at 2^(bits-1), e.g. 32767 for 16 bit
          const normalize: number = 2 ** (pcmChunk.sampleFormat.bits - 1);
          const payload = pcmChunk.sampleFormat.bits >= 24 ? new Int32Array(pcmBuffer) : new Int16Array(pcmBuffer);
          for (let i = 0; i < payload.length; i += 2) {
            read++;
            left[pos] = payload[i] / normalize;
            right[pos] = payload[i + 1] / normalize;
            if (everyN !== 0 && read % everyN === 0 && corrections < Math.abs(addFrames)) {
              corrections++;
              if (addFrames > 0) {
                // Late: the next frame overwrites this one
                pos--;
              } else {
                // Early: play this frame twice
                left[pos + 1] = left[pos];
                right[pos + 1] = right[pos];
                pos++;
              }
            }
            pos++;
          }
          if (pcmChunk.isEndOfChunk()) this.chunk = this.chunks.shift();
        }
        if (read === readFrames) read = frames;
      }
    }

    if (read < frames) {
      left.fill(0, pos);
      right.fill(0, pos);
    }

    // copyToChannel is not supported by Safari
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);
  }
}

class TimeProvider {
  constructor(ctx?: IAudioContextPatched) {
    if (ctx) {
      this.setAudioContext(ctx);
    }
  }

  setAudioContext(ctx: IAudioContextPatched) {
    this.ctx = ctx;
    this.reset();
  }

  reset() {
    this.diffBuffer.length = 0;
    this.diff = 0;
    // Replies to requests sent before now were measured on another clock
    this.pendingRequests.clear();
  }

  // Remember a time request, so only its reply is used for this clock
  trackRequest(id: number) {
    if (this.pendingRequests.size > SYNC_WINDOW) this.pendingRequests.clear();
    this.pendingRequests.add(id & 0xffff);
  }

  // Use a time reply if it answers a request sent on the current clock
  handleReply(refersTo: number, c2s: number, s2c: number): boolean {
    if (!this.pendingRequests.delete(refersTo)) return false;
    this.setDiff(c2s, s2c);
    return true;
  }

  isSynced(): boolean {
    return this.diffBuffer.length >= SYNC_MIN_SAMPLES;
  }

  // The audio clock reads 0 until it runs, which makes samples meaningless
  isRunning(): boolean {
    return this.now() !== 0;
  }

  setDiff(c2s: number, s2c: number) {
    if (!this.isRunning()) return;
    if (this.diffBuffer.push((c2s - s2c) / 2) > SYNC_WINDOW) this.diffBuffer.shift();
    const sorted = [...this.diffBuffer];
    sorted.sort((a, b) => a - b);
    this.diff = sorted[Math.floor(sorted.length / 2)];
  }

  now() {
    if (!this.ctx) {
      return window.performance.now();
    }
    // Use currentTime, the clock buffers are scheduled on. The output
    // latency is added once when scheduling. getOutputTimestamp() would
    // already include it, counting it twice.
    return this.ctx.currentTime * 1000;
  }

  nowSec() {
    return this.now() / 1000;
  }

  serverNow() {
    return this.serverTime(this.now());
  }

  serverTime(localTimeMs: number) {
    return localTimeMs + this.diff;
  }

  diffBuffer: Array<number> = new Array<number>();
  diff: number = 0;
  pendingRequests: Set<number> = new Set<number>();
  ctx?: AudioContext;
}

class SampleFormat {
  rate: number = 48000;
  channels: number = 2;
  bits: number = 16;

  public msRate(): number {
    return this.rate / 1000;
  }

  public toString(): string {
    return this.rate + ':' + this.bits + ':' + this.channels;
  }

  // 24 bit samples are stored in 32 bits
  public sampleSize(): number {
    if (this.bits === 24) {
      return 4;
    }
    return this.bits / 8;
  }

  public frameSize(): number {
    return this.channels * this.sampleSize();
  }
}

class Decoder {
  setHeader(_buffer: ArrayBuffer): SampleFormat | null {
    return new SampleFormat();
  }

  decode(_chunk: PcmChunkMessage): PcmChunkMessage | null | Promise<PcmChunkMessage | null> {
    return null;
  }

  // Release native (WASM) resources
  dispose() {}
}

class FlacDecoder extends Decoder {
  constructor() {
    super();
    this.decoder = this.createDecoder();
  }

  private createDecoder(): number {
    const decoder = Flac.create_libflac_decoder(true);
    if (decoder) {
      Flac.init_decoder_stream(
        decoder,
        this.read_callback_fn.bind(this),
        this.write_callback_fn.bind(this),
        this.error_callback_fn.bind(this),
        this.metadata_callback_fn.bind(this),
        false,
      );
      Flac.setOptions(decoder, { analyseSubframes: true, analyseResiduals: true });
    }
    return decoder;
  }

  decode(chunk: PcmChunkMessage): PcmChunkMessage | null {
    this.flacChunk = chunk.payload.slice(0);
    this.pcmChunk = chunk;
    this.pcmChunk.clearPayload();
    this.cacheInfo = { cachedBlocks: 0, isCachedChunk: true };
    while (this.flacChunk.byteLength > 0) {
      if (!Flac.FLAC__stream_decoder_process_single(this.decoder)) {
        // libflacjs has no flush, and a failed decoder stays failed, so
        // start over from the stream header
        console.warn('FLAC decoding failed, restarting the decoder');
        this.restart();
        return null;
      }
    }
    if (this.cacheInfo.cachedBlocks > 0) {
      const diffMs = this.cacheInfo.cachedBlocks / this.sampleFormat.msRate();
      this.pcmChunk.timestamp.setMilliseconds(this.pcmChunk.timestamp.getMilliseconds() - diffMs);
    }
    return this.pcmChunk;
  }

  private restart() {
    this.dispose();
    this.flacChunk = new ArrayBuffer(0);
    this.decoder = this.createDecoder();
    if (this.streamHeader) this.setHeader(this.streamHeader);
  }

  read_callback_fn(bufferSize: number): Flac.ReadResult | Flac.CompletedReadResult {
    if (this.header) {
      const data = new Uint8Array(this.header);
      this.header = null;
      return { buffer: data, readDataLength: data.byteLength, error: false };
    } else if (this.flacChunk) {
      // a fresh read => next call to write will not be from cached data
      this.cacheInfo.isCachedChunk = false;
      const data = new Uint8Array(this.flacChunk.slice(0, Math.min(bufferSize, this.flacChunk.byteLength)));
      this.flacChunk = this.flacChunk.slice(data.byteLength);
      return { buffer: data, readDataLength: data.byteLength, error: false };
    }
    return { buffer: new Uint8Array(0), readDataLength: 0, error: false };
  }

  write_callback_fn(data: Array<Uint8Array>, frameInfo: Flac.BlockMetadata) {
    if (this.cacheInfo.isCachedChunk) {
      // there was no call to read, so it's some cached data
      this.cacheInfo.cachedBlocks += frameInfo.blocksize;
    }
    const payload = new ArrayBuffer(this.sampleFormat.frameSize() * frameInfo.blocksize);
    const view = new DataView(payload);
    const sample_size = this.sampleFormat.sampleSize();
    for (let channel: number = 0; channel < frameInfo.channels; ++channel) {
      const channelData = new DataView(data[channel].buffer, 0, data[channel].buffer.byteLength);
      for (let i: number = 0; i < frameInfo.blocksize; ++i) {
        const write_idx = sample_size * (frameInfo.channels * i + channel);
        const read_idx = sample_size * i;
        if (sample_size == 4) view.setInt32(write_idx, channelData.getInt32(read_idx, true), true);
        else view.setInt16(write_idx, channelData.getInt16(read_idx, true), true);
      }
    }
    this.pcmChunk!.addPayload(payload);
  }

  metadata_callback_fn(data: any) {
    this.sampleFormat.rate = data.sampleRate;
    this.sampleFormat.channels = data.channels;
    this.sampleFormat.bits = data.bitsPerSample;
  }

  error_callback_fn(err: any, errMsg: any) {
    console.error('FLAC decode error', err, errMsg);
  }

  setHeader(buffer: ArrayBuffer): SampleFormat | null {
    this.streamHeader = buffer.slice(0);
    this.header = buffer.slice(0);
    Flac.FLAC__stream_decoder_process_until_end_of_metadata(this.decoder);
    return this.sampleFormat;
  }

  dispose() {
    if (this.decoder) Flac.FLAC__stream_decoder_delete(this.decoder);
    this.decoder = 0;
  }

  sampleFormat: SampleFormat = new SampleFormat();
  decoder: number;
  // The header still to be read by the decoder, and a copy for restarts
  header: ArrayBuffer | null = null;
  streamHeader: ArrayBuffer | null = null;
  flacChunk: ArrayBuffer = new ArrayBuffer(0);
  pcmChunk?: PcmChunkMessage;

  cacheInfo: { isCachedChunk: boolean; cachedBlocks: number } = { isCachedChunk: false, cachedBlocks: 0 };
}

const OPUS_SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000];

class OpusDecoder extends Decoder {
  setHeader(buffer: ArrayBuffer): SampleFormat | null {
    const view = new DataView(buffer);
    const ID_OPUS = 0x4f505553;
    if (buffer.byteLength < 12) {
      console.error('Opus header too small:', buffer.byteLength);
      return null;
    } else if (view.getUint32(0, true) !== ID_OPUS) {
      console.error('Invalid Opus header magic');
      return null;
    }

    this.sampleFormat.rate = view.getUint32(4, true);
    this.sampleFormat.bits = view.getUint16(8, true);
    this.sampleFormat.channels = view.getUint16(10, true);
    if (!OPUS_SAMPLE_RATES.includes(this.sampleFormat.rate)) {
      console.error('Unsupported Opus sample rate:', this.sampleFormat.rate);
      return null;
    }

    // Decode at the stream's rate; the decoder defaults to 48 kHz
    const decoder = new WasmOpusDecoder({
      sampleRate: this.sampleFormat.rate as OpusDecoderSampleRate,
      channels: this.sampleFormat.channels,
    });
    this.decoder = decoder;
    this.ready = decoder.ready.then(() => decoder.reset());
    this.ready.catch((err) => console.error('Failed to initialize Opus decoder:', err));
    return this.sampleFormat;
  }

  async decode(chunk: PcmChunkMessage): Promise<PcmChunkMessage | null> {
    if (!this.decoder || !this.ready) return null;
    try {
      await this.ready;
      const decoded = this.decoder.decodeFrame(new Uint8Array(chunk.payload));
      if (decoded.errors.length > 0) console.warn('Opus decode errors:', decoded.errors);

      const channels = this.sampleFormat.channels;
      const bytesPerSample = this.sampleFormat.sampleSize();
      const samples = decoded.channelData[0].length;
      const view = new DataView(new ArrayBuffer(samples * bytesPerSample * channels));
      const scale = 2 ** (this.sampleFormat.bits - 1) - 1;
      for (let i = 0; i < samples; i++) {
        for (let channel = 0; channel < channels; channel++) {
          const sample = Math.round(Math.max(-1, Math.min(1, decoded.channelData[channel][i])) * scale);
          const offset = (i * channels + channel) * bytesPerSample;
          if (bytesPerSample === 4) view.setInt32(offset, sample, true);
          else view.setInt16(offset, sample, true);
        }
      }

      chunk.clearPayload();
      chunk.addPayload(view.buffer);
      return chunk;
    } catch (err) {
      console.error('Failed to decode Opus frame:', err);
      return null;
    }
  }

  dispose() {
    this.decoder?.free();
    this.decoder = null;
  }

  private decoder: WasmOpusDecoder<OpusDecoderSampleRate> | null = null;
  private ready: Promise<void> | null = null;
  private sampleFormat: SampleFormat = new SampleFormat();
}

class PcmDecoder extends Decoder {
  setHeader(buffer: ArrayBuffer): SampleFormat | null {
    const sampleFormat = new SampleFormat();
    const view = new DataView(buffer);
    sampleFormat.channels = view.getUint16(22, true);
    sampleFormat.rate = view.getUint32(24, true);
    sampleFormat.bits = view.getUint16(34, true);
    return sampleFormat;
  }

  decode(chunk: PcmChunkMessage): PcmChunkMessage | null {
    return chunk;
  }
}

class PlayBuffer {
  constructor(
    buffer: IAudioBuffer,
    playTime: number,
    source: IAudioBufferSourceNode<IAudioContext>,
    destination: IGainNode<IAudioContext>,
  ) {
    this.buffer = buffer;
    this.playTime = playTime;
    this.source = source;
    this.source.buffer = this.buffer;
    this.source.connect(destination);
  }

  public onended: (_playBuffer: PlayBuffer) => void = () => {};

  start() {
    this.source.onended = () => {
      this.onended(this);
    };
    this.source.start(this.playTime);
  }

  buffer: IAudioBuffer;
  playTime: number;
  source: IAudioBufferSourceNode<IAudioContext>;
}

function createDecoder(codec: string): Decoder | undefined {
  switch (codec) {
    case 'flac':
      return new FlacDecoder();
    case 'pcm':
      return new PcmDecoder();
    case 'opus':
      return new OpusDecoder();
    default:
      return undefined;
  }
}

// Plays the server's audio stream on this device
class SnapStream {
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.timeProvider = new TimeProvider();

    if (this.setupAudioContext()) {
      this.connect();
    } else {
      alert('Sorry, but the Web Audio API is not supported by your browser');
    }
  }

  private setupAudioContext(): boolean {
    if (!AudioContext) return false;
    let options: AudioContextOptions | undefined = {
      latencyHint: 'interactive',
      sampleRate: this.sampleFormat ? this.sampleFormat.rate : undefined,
    };
    const chromeVersion = getChromeVersion();
    if ((chromeVersion !== null && chromeVersion < 55) || !window.AudioContext) {
      // Some older browsers won't decode the stream if options are provided.
      options = undefined;
    }
    this.ctx = new AudioContextPatched(options);
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
    return true;
  }

  public static getClientId(): string {
    return getClientId();
  }

  private connect() {
    if (this.stopped) return;
    const socket = new WebSocket(this.baseUrl + '/stream');
    this.streamsocket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (ev) => this.onMessage(ev);
    socket.onopen = () => {
      const hello = new HelloMessage();
      hello.mac = '00:00:00:00:00:00';
      hello.arch = 'web';
      hello.os = navigator?.platform || 'unknown';
      hello.hostname = 'Snapweb client';
      hello.uniqueId = SnapStream.getClientId();
      this.sendMessage(hello);
      this.syncTime();
      this.syncHandle = window.setInterval(() => this.syncTime(), SYNC_INTERVAL_MS);
    };
    socket.onerror = (ev) => {
      console.error('Stream connection error:', ev);
    };
    socket.onclose = () => {
      this.stopSync();
      this.reconnectHandle = window.setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };
  }

  private onMessage(msg: MessageEvent) {
    if (this.stopped) return;
    const type = new DataView(msg.data).getUint16(0, true);
    switch (type) {
      case MessageType.CodecHeader:
        this.handleCodecHeader(new CodecMessage(msg.data));
        break;
      case MessageType.WireChunk:
        this.handleWireChunk(new PcmChunkMessage(msg.data, this.sampleFormat as SampleFormat));
        break;
      case MessageType.ServerSettings:
        this.handleServerSettings(new ServerSettingsMessage(msg.data));
        break;
      case MessageType.Time:
        this.handleTime(new TimeMessage(msg.data));
        break;
      default:
        console.info('Message not handled, type: ' + type);
    }
  }

  // Sent on connect and when the server's stream or codec changes
  private handleCodecHeader(codec: CodecMessage) {
    // Stop whatever the previous header started, so playback chains and
    // decoders don't pile up
    this.stopAudio();
    this.decoder?.dispose();
    this.stream = undefined;

    this.decoder = createDecoder(codec.codec);
    if (!this.decoder) {
      alert('Codec not supported: ' + codec.codec);
      return;
    }
    const sampleFormat = this.decoder.setHeader(codec.payload);
    if (!sampleFormat || sampleFormat.channels !== 2 || ![16, 24, 32].includes(sampleFormat.bits)) {
      alert('Stream must be stereo with 16, 24 or 32 bit depth, actual format: ' + sampleFormat?.toString());
      this.decoder.dispose();
      this.decoder = undefined;
      return;
    }
    this.sampleFormat = sampleFormat;
    this.bufferFrameCount = Math.floor(BUFFER_DURATION_MS * sampleFormat.msRate());

    // NOTE (curiousercreative): this breaks iOS audio output on v15.7.5 at least
    if (window.AudioContext && sampleFormat.rate !== this.ctx.sampleRate.valueOf()) {
      console.info('Switching the audio context to the stream sample rate of ' + sampleFormat.rate + ' Hz');
      // We don't use webkitAudioContext, so a new AudioContext can be
      // created here without direct user input
      this.closeAudioContext();
      this.setupAudioContext();
    }

    this.ctx.resume();
    this.timeProvider.setAudioContext(this.ctx);
    this.syncBurst();
    this.applyVolume();
    this.stream = new AudioStream(this.timeProvider, sampleFormat, this.bufferMs);
    this.play();
  }

  private handleWireChunk(chunk: PcmChunkMessage) {
    const decoder = this.decoder;
    if (!decoder) return;
    Promise.resolve(decoder.decode(chunk))
      .then((decoded) => {
        // Ignore chunks decoded after the decoder was replaced
        if (decoded && decoder === this.decoder) this.stream?.addChunk(decoded);
      })
      .catch((err) => {
        console.error('Error decoding chunk:', err);
      });
  }

  private handleServerSettings(settings: ServerSettingsMessage) {
    this.serverSettings = settings;
    this.applyVolume();
    this.bufferMs = settings.bufferMs - settings.latency;
  }

  private handleTime(time: TimeMessage) {
    this.timeProvider.handleReply(
      time.refersTo,
      time.latency.getMilliseconds(),
      this.timeProvider.now() - time.sent.getMilliseconds(),
    );
  }

  private applyVolume() {
    if (this.serverSettings)
      this.gainNode.gain.value = this.serverSettings.muted ? 0 : this.serverSettings.volumePercent / 100;
  }

  private sendMessage(msg: BaseMessage) {
    msg.sent = new Tv(0, 0);
    msg.sent.setMilliseconds(this.timeProvider.now());
    msg.id = ++this.msgId;
    if (this.streamsocket?.readyState === WebSocket.OPEN) {
      this.streamsocket.send(msg.serialize());
    }
  }

  private syncTime() {
    // A request sent before the audio clock runs would carry a 0 timestamp
    if (!this.timeProvider.isRunning()) return;
    const t = new TimeMessage();
    t.latency.setMilliseconds(this.timeProvider.now());
    this.sendMessage(t);
    this.timeProvider.trackRequest(t.id);
  }

  // Sync quickly after switching clocks instead of waiting for the interval
  private syncBurst() {
    this.clearSyncBurst();
    for (let i = 0; i < SYNC_BURST_COUNT; ++i)
      this.syncBurstHandles.push(window.setTimeout(() => this.syncTime(), i * SYNC_BURST_SPACING_MS));
  }

  private clearSyncBurst() {
    this.syncBurstHandles.forEach((handle) => window.clearTimeout(handle));
    this.syncBurstHandles = [];
  }

  private stopSync() {
    window.clearInterval(this.syncHandle);
    this.clearSyncBurst();
  }

  // Stop the scheduled buffers and their onended -> playNext chain
  private stopAudio() {
    while (this.audioBuffers.length > 0) {
      const buffer = this.audioBuffers.pop()!;
      buffer.onended = () => {};
      buffer.source.stop();
    }
    this.freeBuffers = [];
  }

  // Browsers limit how many AudioContexts can exist, so close them
  private closeAudioContext() {
    this.stopAudio();
    this.gainNode?.disconnect();
    this.ctx?.close().catch((e) => console.warn('Failed to close the audio context: ' + e));
  }

  public stop() {
    this.stopped = true;
    this.stopSync();
    window.clearTimeout(this.reconnectHandle);
    const socket = this.streamsocket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    }
    this.closeAudioContext();
    this.decoder?.dispose();
    this.decoder = undefined;
    this.stream = undefined;
  }

  public play() {
    this.playTime = this.timeProvider.nowSec() + PLAY_START_DELAY_S;
    for (let i = 0; i < AUDIO_BUFFER_COUNT; ++i) {
      this.playNext();
    }
  }

  public playNext() {
    if (!this.stream || !this.sampleFormat) return;
    const buffer =
      this.freeBuffers.pop() ||
      this.ctx.createBuffer(this.sampleFormat.channels, this.bufferFrameCount, this.sampleFormat.rate);
    // Read every time, since the output device (and its latency) can change
    const latency = (this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0);
    const playTimeMs = (this.playTime + latency) * 1000 - this.bufferMs;
    this.stream.getNextBuffer(buffer, playTimeMs);

    const source = this.ctx.createBufferSource();
    const playBuffer = new PlayBuffer(buffer, this.playTime, source, this.gainNode);
    this.audioBuffers.push(playBuffer);
    playBuffer.onended = (ended: PlayBuffer) => {
      this.freeBuffers.push(this.audioBuffers.splice(this.audioBuffers.indexOf(ended), 1)[0].buffer);
      this.playNext();
    };
    playBuffer.start();
    this.playTime += this.bufferFrameCount / this.sampleFormat.rate;
  }

  baseUrl: string;
  streamsocket?: WebSocket;
  stopped: boolean = false;
  playTime: number = 0;
  msgId: number = 0;
  bufferFrameCount: number = 0;
  syncHandle: number = -1;
  syncBurstHandles: number[] = [];
  reconnectHandle: number = -1;
  audioBuffers: Array<PlayBuffer> = new Array<PlayBuffer>();
  freeBuffers: Array<IAudioBuffer> = new Array<IAudioBuffer>();

  timeProvider: TimeProvider;
  stream: AudioStream | undefined;
  ctx!: IAudioContextPatched;
  gainNode!: IGainNode<IAudioContext>;
  serverSettings: ServerSettingsMessage | undefined;
  decoder: Decoder | undefined;
  sampleFormat: SampleFormat | undefined;
  bufferMs: number = 1000;
}

export { SnapStream };
export { AudioStream, JsonMessage, HelloMessage, PcmChunkMessage, SampleFormat, TimeMessage, TimeProvider, Tv };
