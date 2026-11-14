import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { isImageKitMediaUrl } from './_imagekitUpload.js';
import { getOriginalImageKitUrl } from '../shared/imageKitUrl.js';

const run = promisify(execFile);
const MAX_BYTES = 48 * 1024 * 1024;
// Probe both files with ffmpeg itself (no separate ffprobe binary needed --
// Duration is in the same header ffmpeg prints while opening any input) so
// narration never gets silently cut off by the video duration.
const DURATION_GUARD_TOLERANCE_SECONDS = 0.1;
const BACKGROUND_MUSIC_PATH = fileURLToPath(new URL('../public/audio/video-background.mp3', import.meta.url));

const parseFfmpegDurationSeconds = (output) => {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(output || ''));
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
};

async function probeDurationSeconds(filePath) {
  try {
    const { stderr } = await run(ffmpegPath, [
      '-hide_banner', '-nostdin', '-i', filePath, '-t', '0.01', '-f', 'null', '-',
    ], { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
    return parseFfmpegDurationSeconds(stderr);
  } catch (error) {
    // ffmpeg can exit non-zero for a stub output it still fully opened and
    // printed Duration for -- the header info is on the error itself.
    return parseFfmpegDurationSeconds(error?.stderr);
  }
}

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

// Keep the original video stream and mix the separately generated narration
// with a quiet, original music bed that remains audible after speech ends.
export async function replaceVideoNarration(videoUrl, audioUrl) {
  if (!ffmpegPath) throw new Error('Video narration assembly is unavailable on this platform.');
  const directory = await mkdtemp(join(tmpdir(), 'khmer-narration-'));
  try {
    const [video, audio] = await Promise.all([download(videoUrl), download(audioUrl)]);
    const videoPath = join(directory, 'video.mp4');
    const audioPath = join(directory, 'narration.audio');
    const outputPath = join(directory, 'output.mp4');
    await Promise.all([writeFile(videoPath, video), writeFile(audioPath, audio)]);
    const [videoDuration, audioDuration] = await Promise.all([
      probeDurationSeconds(videoPath),
      probeDurationSeconds(audioPath),
    ]);
    if (!Number.isFinite(videoDuration) || !Number.isFinite(audioDuration) || videoDuration <= 0 || audioDuration <= 0) {
      throw new Error('Could not verify video and narration durations before assembly.');
    }
    if (audioDuration > videoDuration + DURATION_GUARD_TOLERANCE_SECONDS) {
      throw new Error(`Khmer narration (${audioDuration.toFixed(2)}s) is longer than the generated video (${videoDuration.toFixed(2)}s). Regenerate the video instead of shipping cut-off speech.`);
    }
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-protocol_whitelist', 'file,pipe', '-i', videoPath,
      '-protocol_whitelist', 'file,pipe', '-i', audioPath,
      '-stream_loop', '-1', '-protocol_whitelist', 'file,pipe', '-i', BACKGROUND_MUSIC_PATH,
      '-filter_complex', `[1:a]apad=whole_dur=${videoDuration}[voice];[2:a]volume='if(lt(t,${Math.min(videoDuration, audioDuration + 0.15)}),0.12,0.45)':eval=frame[music];[voice][music]amix=inputs=2:duration=first:normalize=0[aout]`,
      '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(videoDuration),
      '-movflags', '+faststart', '-fs', String(MAX_BYTES), outputPath,
    ], { timeout: 60000, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 1024 * 1024 });
    const output = await readFile(outputPath);
    if (!output.length || output.length >= MAX_BYTES) throw new Error('Assembled narration video exceeds the upload limit.');
    return `data:video/mp4;base64,${output.toString('base64')}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
