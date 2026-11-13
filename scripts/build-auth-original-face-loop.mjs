import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep the existing 1920x1080 hero and typing animation pixel-for-pixel.
// Only resample a small patch of the original face for brief blinks and a
// slight change in the existing smile. No replacement face is introduced.
const root = new URL('../', import.meta.url);
const framesUrl = new URL('../tmp/auth-original-face-frames/', import.meta.url);
await mkdir(framesUrl, { recursive: true });
const pathFor = (relative) => fileURLToPath(new URL(relative, root));
const framePath = (index) => fileURLToPath(new URL(`face-${String(index).padStart(3, '0')}.png`, framesUrl));

const region = { left: 951, top: 502, width: 151, height: 139 };
const { data: original, info } = await sharp(pathFor('public/auth-keyboard-poster.webp'))
  .extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const pixel = (x, y, channel) => original[(Math.min(height - 1, Math.max(0, y)) * width
  + Math.min(width - 1, Math.max(0, x))) * channels + channel];
const sample = (x, y, channel) => {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  return (1 - fy) * ((1 - fx) * pixel(x0, y0, channel) + fx * pixel(x0 + 1, y0, channel))
    + fy * ((1 - fx) * pixel(x0, y0 + 1, channel) + fx * pixel(x0 + 1, y0 + 1, channel));
};
const pulse = (time, center, halfWidth) => Math.max(0, 1 - Math.abs(time - center) / halfWidth) ** 1.5;
const ellipse = (x, y, cx, cy, rx, ry) => Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2);

const frameCount = 97;
for (let frame = 0; frame < frameCount; frame++) {
  const time = frame / 24;
  // Both ends match, so the original four-second typing loop remains seamless.
  const blink = Math.max(pulse(time, 0.92, 0.19), pulse(time, 2.94, 0.19));
  const smile = Math.sin(Math.PI * time / 4) ** 2;
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = x + region.left, gy = y + region.top;
      let sourceY = y;
      for (const eye of [{ x: 1001, y: 532 }, { x: 1061, y: 534 }]) {
        const influence = ellipse(gx, gy, eye.x, eye.y, 29, 10);
        sourceY += (gy - eye.y) * blink * influence * 1.7;
      }
      const mouth = ellipse(gx, gy, 1017, 596, 48, 21);
      sourceY -= (gy - 596) * smile * mouth * 0.26;
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      const alpha = Math.round(255 * Math.min(1, Math.max(0, edge / 13)));
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round(sample(x, sourceY, channel));
      output[offset + 3] = alpha;
    }
  }
  await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(framePath(frame));
}

const result = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', pathFor('public/auth-keyboard-loop.mp4'),
  '-framerate', '24', '-i', path.join(fileURLToPath(framesUrl), 'face-%03d.png'),
  '-filter_complex', `[0:v][1:v]overlay=x=${region.left}:y=${region.top}:shortest=1:format=auto,format=yuv420p[out]`,
  '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-frames:v', String(frameCount), '-movflags', '+faststart',
  pathFor('public/auth-original-face-loop.mp4'),
], { stdio: 'inherit' });
if (result.status !== 0) throw new Error(`ffmpeg exited with ${result.status}`);
