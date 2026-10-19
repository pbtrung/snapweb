import { describe, expect, it } from 'vitest';
import { OpusDecoder } from '../../src/snapstream';
import { wireChunk } from '../helpers/wireChunk';

// The snapcast Opus header: "OPUS" magic, then rate, bits and channels
function opusHeader(rate: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(12));
  view.setUint32(0, 0x4f505553, true);
  view.setUint32(4, rate, true);
  view.setUint16(8, 16, true);
  view.setUint16(10, 2, true);
  return view.buffer;
}

describe('OpusDecoder', () => {
  it('rejects unsupported headers', () => {
    expect(new OpusDecoder().setHeader(new ArrayBuffer(4))).toBeNull();
    expect(new OpusDecoder().setHeader(opusHeader(44100))).toBeNull();
  });

  it('decodes a 120 ms packet', async () => {
    const decoder = new OpusDecoder();
    expect(decoder.setHeader(opusHeader(48000))!.toString()).toBe('48000:16:2');
    // TOC: CELT fullband 20 ms, stereo, code 3 (several frames); then 6
    // constant-size frames of 0 bytes each, which decode as concealment
    const chunk = await decoder.decode(wireChunk(0, new Uint8Array([0xff, 0x06])));
    expect(chunk!.getFrameCount()).toBe(6 * 960);
    decoder.dispose();
  });
});
