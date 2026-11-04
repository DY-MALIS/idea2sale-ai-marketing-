import { it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { replaceVideoNarration } from '../../api/_videoNarrationMux.js';

const run = promisify(execFile);
// CI runners can take longer than 20s for the fixture encodes, duration probes,
// mux, and audio decode. The mux itself has a 60s process timeout.
const MUX_TEST_TIMEOUT_MS = 90000;
it('replaces generated audio while preserving the full video length', async () => {
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
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video], { windowsHide: true, timeout: 15000 });
    console.log('mux test: video fixture created');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.4', audio], { windowsHide: true, timeout: 15000 });
    console.log('mux test: audio fixture created');
    const videoBytes = await readFile(video);
    const audioBytes = await readFile(audio);
    global.fetch = vi.fn(async url => new Response(url.endsWith('video.mp4') ? videoBytes : audioBytes));
    const result = await replaceVideoNarration('https://ik.imagekit.io/test/video.mp4', 'https://ik.imagekit.io/test/audio.wav');
    console.log('mux test: narration replaced');
    await writeFile(output, Buffer.from(result.split(',')[1], 'base64'));
    // Bound the decode even if a broken output contains an unbounded padded
    // audio stream; the duration assertions below still reject anything >2.1s.
    const { stdout } = await run(ffmpeg, ['-v', 'error', '-nostdin', '-i', output, '-map', '0:a:0', '-t', '2.2', '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { encoding: 'buffer', windowsHide: true, timeout: 15000 });
    console.log('mux test: audio decoded');
    expect(stdout.length / 16000).toBeGreaterThanOrEqual(1.95);
    expect(stdout.length / 16000).toBeLessThan(2.1);
    // Count positive zero crossings over 0.5 seconds: reference is 880 Hz,
    // whereas retaining the model's original track would measure 220 Hz.
    let crossings = 0;
    for (let i = 801; i < 4800; i++) {
      if (stdout.readInt16LE((i - 1) * 2) <= 0 && stdout.readInt16LE(i * 2) > 0) crossings++;
    }
    expect(crossings * 2).toBeGreaterThan(860);
    expect(crossings * 2).toBeLessThan(900);
    let tailPeak = 0;
    for (let i = 11600; i < 12400; i++) tailPeak = Math.max(tailPeak, Math.abs(stdout.readInt16LE(i * 2)));
    expect(tailPeak).toBeLessThan(10);
  } finally {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}, MUX_TEST_TIMEOUT_MS);

it('rejects narration longer than the video instead of silently truncating it via -shortest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mux-overrun-test-'));
  const originalFetch = global.fetch;
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/test');
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'test');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'test');
  try {
    const video = join(dir, 'video.mp4');
    const audio = join(dir, 'audio.wav');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=25:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video], { windowsHide: true });
    // Narration (3s) deliberately outlasts the 2s video -- this must fail
    // loudly rather than ship a video whose speech is cut off mid-word.
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', audio], { windowsHide: true });
    const videoBytes = await readFile(video);
    const audioBytes = await readFile(audio);
    global.fetch = vi.fn(async url => new Response(url.endsWith('video.mp4') ? videoBytes : audioBytes));
    await expect(replaceVideoNarration('https://ik.imagekit.io/test/video.mp4', 'https://ik.imagekit.io/test/audio.wav'))
      .rejects.toThrow(/longer than the generated video/);
  } finally {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}, MUX_TEST_TIMEOUT_MS);
