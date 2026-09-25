import { it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { replaceVideoNarration } from '../../api/_videoNarrationMux.js';

const run = promisify(execFile);
it('replaces the generated audio, preserves video length, and pads the narration tail with silence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mux-test-'));
  const originalFetch = global.fetch;
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/test');
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'test');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'test');
  try {
    const video = join(dir, 'video.mp4');
    const audio = join(dir, 'audio.wav');
    const output = join(dir, 'output.mp4');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=25:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video], { windowsHide: true });
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.4', audio], { windowsHide: true });
    const videoBytes = await readFile(video);
    const audioBytes = await readFile(audio);
    global.fetch = vi.fn(async url => new Response(url.endsWith('video.mp4') ? videoBytes : audioBytes));
    const result = await replaceVideoNarration('https://ik.imagekit.io/test/video.mp4', 'https://ik.imagekit.io/test/audio.wav');
    await writeFile(output, Buffer.from(result.split(',')[1], 'base64'));
    const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { encoding: 'buffer', windowsHide: true });
    expect(stdout.length / 16000).toBeGreaterThanOrEqual(1.95);
    expect(stdout.length / 16000).toBeLessThan(2.15);
    // Count positive zero crossings over 0.5 seconds: reference is 880 Hz,
    // whereas retaining the model's original track would measure 220 Hz.
    let crossings = 0;
    for (let i = 801; i < 4800; i++) {
      if (stdout.readInt16LE((i - 1) * 2) <= 0 && stdout.readInt16LE(i * 2) > 0) crossings++;
    }
    expect(crossings * 2).toBeGreaterThan(860);
    expect(crossings * 2).toBeLessThan(900);
    let tailPeak = 0;
    for (let i = 13600; i < 15200; i++) tailPeak = Math.max(tailPeak, Math.abs(stdout.readInt16LE(i * 2)));
    expect(tailPeak).toBeLessThan(10);
  } finally {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
