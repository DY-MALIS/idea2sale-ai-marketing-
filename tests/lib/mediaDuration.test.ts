import { describe, expect, it } from 'vitest';
import { ffprobeDurationSeconds, mp4DurationSeconds } from '../../src/lib/mediaDuration';

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

  it('returns null instead of throwing when the backing buffer is detached', () => {
    const bytes = new Uint8Array(20);
    // structuredClone's transfer option is the standard way to detach an
    // ArrayBuffer in a test -- same end state ffmpeg.wasm leaves a buffer in
    // after writeFile() transfers it away from the caller.
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(bytes.buffer.byteLength).toBe(0);
    expect(mp4DurationSeconds(bytes)).toBeNull();
  });
});

describe('duration from ffmpeg.wasm probe', () => {
  it('reads a downloaded media file without browser metadata', async () => {
    let probeArgs: string[] = [];
    let probeTimeout = 0;
    const ffmpeg = {
      ffprobe: async (args: string[], timeout?: number) => {
        probeArgs = args;
        probeTimeout = timeout || 0;
        return 0;
      },
      readFile: async () => '7.840000\n',
    };
    expect(await ffprobeDurationSeconds(ffmpeg, 'voice.mp3', 'voice-duration.txt')).toBe(7.84);
    expect(probeArgs).toContain('voice.mp3');
    expect(probeArgs.slice(-2)).toEqual(['-o', 'voice-duration.txt']);
    expect(probeTimeout).toBe(15000);
  });

  it('returns null for a failed or unusable probe', async () => {
    expect(await ffprobeDurationSeconds({ ffprobe: async () => 1, readFile: async () => '' }, 'clip.mp4', 'duration.txt')).toBeNull();
    expect(await ffprobeDurationSeconds({ ffprobe: async () => 0, readFile: async () => 'N/A' }, 'clip.mp4', 'duration.txt')).toBeNull();
  });
});
