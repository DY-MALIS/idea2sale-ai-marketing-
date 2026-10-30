import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { isR2MediaUrl } from './_r2Storage.js';
import { isCloudinaryMediaUrl } from './_cloudinaryStorage.js';

const run = promisify(execFile);
export async function extractR2Audio(videoUrl) {
  if (!isR2MediaUrl(videoUrl) && !isCloudinaryMediaUrl(videoUrl)) throw new Error('Invalid stored video URL.');
  if (!ffmpegPath) throw new Error('Audio extraction is unavailable.');
  const response = await fetch(videoUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || Number(response.headers.get('content-length')) > 48 * 1024 * 1024) throw new Error('R2 video is unavailable for speech verification.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 48 * 1024 * 1024) throw new Error('R2 video exceeds speech verification limit.');
  const directory = await mkdtemp(join(tmpdir(), 'r2-speech-'));
  try {
    const input = join(directory, 'video.mp4');
    const output = join(directory, 'audio.mp4');
    await writeFile(input, bytes);
    await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '96k', '-fs', '6000000', output], { timeout: 60000, windowsHide: true });
    return readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
