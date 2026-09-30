import { describe, expect, it } from 'vitest';
import { mp4DurationSeconds } from '../../src/lib/mediaDuration';

const box = (name: string, payload: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(payload.length + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  for (let index = 0; index < 4; index += 1) bytes[index + 4] = name.charCodeAt(index);
  bytes.set(payload, 8);
  return bytes;
};

describe('MP4 duration from downloaded bytes', () => {
  it('reads the movie header without waiting for browser media metadata', () => {
    const header = new Uint8Array(20);
    const view = new DataView(header.buffer);
    view.setUint32(12, 1000);
    view.setUint32(16, 8000);
    expect(mp4DurationSeconds(box('moov', box('mvhd', header)))).toBe(8);
  });

  it('returns null for truncated or invalid clips', () => {
    expect(mp4DurationSeconds(new Uint8Array([0, 0, 0, 20, 109, 111, 111, 118]))).toBeNull();
  });
});
