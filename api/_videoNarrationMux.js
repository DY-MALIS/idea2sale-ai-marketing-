import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { isImageKitMediaUrl } from './_imagekitUpload.js';
import { getOriginalImageKitUrl } from '../shared/imageKitUrl.js';

const run = promisify(execFile);
const MAX_BYTES = 48 * 1024 * 1024;

async function download(url) {
  if (!isImageKitMediaUrl(url)) throw new Error('Narration assembly requires stored ImageKit media.');
  const response = await fetch(getOriginalImageKitUrl(url, process.env.IMAGEKIT_URL_ENDPOINT), {
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body) throw new Error('Could not download media for Khmer narration.');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Narration media is too large.');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_BYTES) throw new Error('Narration media is too large.');
    chunks.push(Buffer.from(chunk));
  }
  if (!length) throw new Error('Narration media is empty.');
  return Buffer.concat(chunks);
}

// Map ONLY the original video stream and the separately generated Khmer audio.
// Padding preserves the tail of the clip; no generated speech survives the mux.
export async function replaceVideoNarration(videoUrl, audioUrl) {
  if (!ffmpegPath) throw new Error('Video narration assembly is unavailable on this platform.');
  const directory = await mkdtemp(join(tmpdir(), 'khmer-narration-'));
  try {
    const [video, audio] = await Promise.all([download(videoUrl), download(audioUrl)]);
    const videoPath = join(directory, 'video.mp4');
    const audioPath = join(directory, 'narration.audio');
    const outputPath = join(directory, 'output.mp4');
    await Promise.all([writeFile(videoPath, video), writeFile(audioPath, audio)]);
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-protocol_whitelist', 'file,pipe', '-i', videoPath,
      '-protocol_whitelist', 'file,pipe', '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest',
      '-movflags', '+faststart', '-fs', String(MAX_BYTES), outputPath,
    ], { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const output = await readFile(outputPath);
    if (!output.length || output.length >= MAX_BYTES) throw new Error('Assembled narration video exceeds the upload limit.');
    return `data:video/mp4;base64,${output.toString('base64')}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
