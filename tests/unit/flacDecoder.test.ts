import { describe, expect, it } from 'vitest';
import Flac from 'libflacjs/dist/libflac.js';
import { FlacDecoder, PcmChunkMessage } from '../../src/snapstream';
import { wireChunk } from '../helpers/wireChunk';

const RATE = 48000;
const BLOCK_SIZE = 1152;

// Encodes blocks of stereo audio, frame n of block b carrying the sample
// value b * 1000 + n % 1000, into a FLAC stream header and one FLAC frame
// per block
function encode(blocks: number, bits = 16): { header: Uint8Array; frames: Uint8Array[] } {
  const encoder = Flac.create_libflac_encoder(RATE, 2, bits, 5, 0, false, BLOCK_SIZE);
  const header: Uint8Array[] = [];
  const frames: Uint8Array[] = [];
  Flac.init_encoder_stream(encoder, (data, _bytes, samples) => {
    (samples > 0 ? frames : header).push(data.slice());
  });
  for (let b = 0; b < blocks; ++b) {
    const pcm = new Int32Array(2 * BLOCK_SIZE);
    for (let n = 0; n < BLOCK_SIZE; ++n) pcm[2 * n] = pcm[2 * n + 1] = b * 1000 + (n % 1000);
    Flac.FLAC__stream_encoder_process_interleaved(encoder, pcm, BLOCK_SIZE);
  }
  Flac.FLAC__stream_encoder_finish(encoder);
  Flac.FLAC__stream_encoder_delete(encoder);
  return { header: concat(header), frames };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// The left channel's samples
function samples(chunk: PcmChunkMessage, bits = 16): number[] {
  const all = bits === 16 ? new Int16Array(chunk.payload) : new Int32Array(chunk.payload);
  return Array.from(all).filter((_, i) => i % 2 === 0);
}

function expected(blocks: number[]): number[] {
  return blocks.flatMap((b) => Array.from({ length: BLOCK_SIZE }, (_, n) => b * 1000 + (n % 1000)));
}

describe('FlacDecoder', () => {
  const blockMs = (1000 * BLOCK_SIZE) / RATE;

  function decoder(header: Uint8Array, bits = 16) {
    const flac = new FlacDecoder();
    const format = flac.setHeader(header.slice().buffer)!;
    expect(format.toString()).toBe('48000:' + bits + ':2');
    return flac;
  }

  it('decodes one frame per chunk', () => {
    const { header, frames } = encode(3);
    const flac = decoder(header);
    frames.forEach((frame, b) => {
      const chunk = flac.decode(wireChunk(1000 + b * blockMs, frame))!;
      expect(samples(chunk)).toEqual(expected([b]));
      expect(chunk.timestamp.getMilliseconds()).toBeCloseTo(1000 + b * blockMs, 3);
    });
    flac.dispose();
  });

  it('decodes every frame of a chunk carrying several', () => {
    const { header, frames } = encode(6);
    const flac = decoder(header);
    for (let c = 0; c < 2; ++c) {
      const startMs = 1000 + 3 * c * blockMs;
      const chunk = flac.decode(wireChunk(startMs, concat(frames.slice(3 * c, 3 * c + 3))))!;
      expect(samples(chunk)).toEqual(expected([3 * c, 3 * c + 1, 3 * c + 2]));
      expect(chunk.timestamp.getMilliseconds()).toBeCloseTo(startMs, 3);
    }
    flac.dispose();
  });

  it('decodes 24 bit samples into 32 bit ones', () => {
    const { header, frames } = encode(2, 24);
    const flac = decoder(header, 24);
    const chunk = flac.decode(wireChunk(1000, concat(frames)))!;
    expect(samples(chunk, 24)).toEqual(expected([0, 1]));
    flac.dispose();
  });

  it('recovers after a corrupt chunk', () => {
    const { header, frames } = encode(3);
    const flac = decoder(header);
    expect(samples(flac.decode(wireChunk(1000, frames[0]))!)).toEqual(expected([0]));
    // Without a frame sync, the decoder skips the bytes and finds no frame
    const garbage = flac.decode(wireChunk(1000 + blockMs, new Uint8Array(64).fill(0x55)));
    expect(garbage?.payload.byteLength ?? 0).toBe(0);
    expect(samples(flac.decode(wireChunk(1000 + 2 * blockMs, frames[2]))!)).toEqual(expected([2]));
    flac.dispose();
  });
});
