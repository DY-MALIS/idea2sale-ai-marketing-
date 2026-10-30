import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { isR2MediaUrl, uploadR2Bytes } from './_r2Storage.js';
import { isCloudinaryMediaUrl, uploadCloudinaryFile } from './_cloudinaryStorage.js';

const run = promisify(execFile);
const MAX_BYTES = 48 * 1024 * 1024;

export async function transformR2Video(videoUrl, { mute = false, logoDataUrl = '' } = {}) {
  if (!mute && !logoDataUrl) return videoUrl;
  if ((!isR2MediaUrl(videoUrl) && !isCloudinaryMediaUrl(videoUrl)) || !ffmpegPath) throw new Error('Stored video processing is unavailable.');
  const response = await fetch(videoUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Could not read the R2 video for processing.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('R2 video is too large to process.');
  const directory = await mkdtemp(join(tmpdir(), 'r2-video-'));
  try {
    const input = join(directory, 'input.mp4');
    const output = join(directory, 'output.mp4');
    await writeFile(input, bytes);
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input];
    if (logoDataUrl) {
      const match = String(logoDataUrl).match(/^data:image\/(?:png|jpeg|webp);base64,(.+)$/);
      if (!match) throw new Error('Invalid business logo for video overlay.');
      const logo = join(directory, 'logo.png');
      await writeFile(logo, Buffer.from(match[1], 'base64'));
      args.push('-i', logo, '-filter_complex', '[1:v]scale=120:-1[logo];[0:v][logo]overlay=W-w-16:H-h-16[v]', '-map', '[v]');
    } else args.push('-map', '0:v:0');
    if (!mute) args.push('-map', '0:a?');
    args.push('-c:v', logoDataUrl ? 'libx264' : 'copy', ...(logoDataUrl ? ['-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p'] : []),
      ...(mute ? ['-an'] : ['-c:a', 'copy']), '-movflags', '+faststart', '-fs', String(MAX_BYTES), output);
    await run(ffmpegPath, args, { timeout: 120000, windowsHide: true });
    const outputBytes = await readFile(output);
    if (isCloudinaryMediaUrl(videoUrl)) {
      return (await uploadCloudinaryFile({ file: `data:video/mp4;base64,${outputBytes.toString('base64')}`, mediaType: 'video', folder: '/generation-history' })).mediaUrl;
    }
    return (await uploadR2Bytes({ bytes: outputBytes, contentType: 'video/mp4', mediaType: 'video', folder: '/generation-history', fileName: 'processed-video.mp4' })).mediaUrl;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
