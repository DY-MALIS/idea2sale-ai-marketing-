import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { audioShiftFilter, lastAudibleSpeechSecond, speechTailCutSecond } from '../../src/lib/videoAudioTiming';
import { mp4DurationSeconds } from '../../src/lib/mediaDuration';

const run = promisify(execFile);
const sampleRate = 24000;

const firstAudibleSecond = (pcm: Buffer) => {
  for (let sample = 0; sample < pcm.length / 2; sample++) {
    if (Math.abs(pcm.readInt16LE(sample * 2)) > 1000) return sample / sampleRate;
  }
  return Infinity;
};

it('shifts an existing audio track earlier or later without changing clip length', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-audio-timing-'));
  const source = join(directory, 'speech.mp4');
  try {
    await run(ffmpeg, ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=25:d=5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=0.5',
      '-filter:a', 'adelay=400:all=1,apad', '-t', '5', '-c:v', 'libx264', '-c:a', 'aac', source],
    { windowsHide: true });
    const { stdout: sourcePcm } = await run(ffmpeg, ['-v', 'error', '-i', source,
      '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, maxBuffer: 1024 * 1024 });
    expect(lastAudibleSpeechSecond(sourcePcm)).toBeCloseTo(0.9, 1);
    expect(lastAudibleSpeechSecond(new Uint8Array(sampleRate))).toBeNull();
    const trimmed = join(directory, 'trimmed.mp4');
    const cutAt = speechTailCutSecond(lastAudibleSpeechSecond(sourcePcm)!, 5);
    expect(cutAt).toBeCloseTo(1.1, 1);
    await run(ffmpeg, ['-v', 'error', '-y', '-i', source, '-t', cutAt!.toFixed(3),
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-filter:a', `atrim=end=${cutAt!.toFixed(3)},asetpts=PTS-STARTPTS`,
      '-c:a', 'aac', '-b:a', '160k', trimmed],
    { windowsHide: true });
    const trimmedDuration = mp4DurationSeconds(await readFile(trimmed));
    expect(trimmedDuration).toBeGreaterThanOrEqual(1.1);
    expect(trimmedDuration).toBeLessThan(1.25);
    for (const [offset, expectedOnset] of [[-250, 0.15], [0, 0.4], [250, 0.65]]) {
      const output = join(directory, `shifted-${offset}.mp4`);
      await run(ffmpeg, ['-v', 'error', '-y', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
        '-filter:a', audioShiftFilter(offset), '-c:a', 'aac', '-ar', '48000',
        '-shortest', '-movflags', '+faststart', output], { windowsHide: true });
      const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', output,
        '-t', '2', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1'],
      { encoding: 'buffer', windowsHide: true, maxBuffer: 1024 * 1024 });
      expect(stdout.length / (sampleRate * 2)).toBeGreaterThan(1.95);
      expect(firstAudibleSecond(stdout)).toBeCloseTo(expectedOnset, 1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

it('rejects adjustments beyond the supported range', () => {
  expect(() => audioShiftFilter(1001)).toThrow('within one second');
  expect(speechTailCutSecond(1.86, 4)).toBeCloseTo(2.06, 2);
  expect(speechTailCutSecond(3.8, 4)).toBeNull();
});
