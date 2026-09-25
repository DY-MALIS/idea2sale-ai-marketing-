import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { trimVideoNarrationSilence } from '../../api/_videoNarrationTiming.js';

const run = promisify(execFile);

it('removes only outer TTS silence while preserving a pause inside speech', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'narration-timing-test-'));
  try {
    const source = join(directory, 'speech.wav');
    await run(ffmpegPath, ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono:d=0.3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono:d=0.25',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=24000:duration=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono:d=0.6',
      '-filter_complex', '[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[out]',
      '-map', '[out]', source], { windowsHide: true });
    const original = await readFile(source);
    const result = await trimVideoNarrationSilence({
      audioUrl: `data:audio/wav;base64,${original.toString('base64')}`,
      duration: 3.15,
    });
    expect(result.duration).toBeGreaterThan(2.35);
    expect(result.duration).toBeLessThan(2.6);
    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
