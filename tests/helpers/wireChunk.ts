import { PcmChunkMessage, SampleFormat, Tv } from '../../src/snapstream';

// A WireChunk message carrying payload, starting at timestampMs
export function wireChunk(
  timestampMs: number,
  payload: Uint8Array,
  sampleFormat: SampleFormat = new SampleFormat(),
): PcmChunkMessage {
  const buffer = new ArrayBuffer(38 + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint16(0, 2, true);
  const ts = new Tv(0, 0);
  ts.setMilliseconds(timestampMs);
  view.setInt32(26, ts.sec, true);
  view.setInt32(30, ts.usec, true);
  view.setUint32(34, payload.byteLength, true);
  new Uint8Array(buffer, 38).set(payload);
  return new PcmChunkMessage(buffer, sampleFormat);
}
