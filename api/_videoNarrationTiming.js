import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { parseBuffer } from 'music-metadata';

const run = promisify(execFile);
const SAMPLE_RATE = 24000;
const WINDOW_SAMPLES = 240; // 10 ms
const ACTIVE_RMS = 150; // approximately -47 dBFS

// TTS files can contain substantial silence at both ends. The video model may
// start moving lips at frame zero and keep talking until the end of the clip,
// so send it the same tightly bounded waveform that we later mux for delivery.
export async function trimVideoNarrationSilence(audio) {
  const match = /^data:audio\/[^;,]+;base64,([\s\S]+)$/.exec(String(audio?.audioUrl || ''));
  if (!match || !ffmpegPath) return audio;
  const directory = await mkdtemp(join(tmpdir(), 'khmer-video-timing-'));
  try {
    const source = join(directory, 'source.audio');
    const pcmPath = join(directory, 'decoded.pcm');
    const outputPath = join(directory, 'trimmed.mp3');
    await writeFile(source, Buffer.from(match[1], 'base64'));
    await run(ffmpegPath, ['-v', 'error', '-nostdin', '-y', '-i', source,
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', pcmPath],
    { timeout: 30000, windowsHide: true });
    const pcm = await readFile(pcmPath);
    const windowCount = Math.floor(pcm.length / (WINDOW_SAMPLES * 2));
    let firstActive = -1;
    let lastActive = -1;
    for (let window = 0; window < windowCount; window++) {
      let sumSquares = 0;
      const start = window * WINDOW_SAMPLES;
      for (let i = 0; i < WINDOW_SAMPLES; i++) {
        const sample = pcm.readInt16LE((start + i) * 2);
        sumSquares += sample * sample;
      }
      if (Math.sqrt(sumSquares / WINDOW_SAMPLES) >= ACTIVE_RMS) {
        if (firstActive < 0) firstActive = window;
        lastActive = window;
      }
    }
    if (firstActive < 0) throw new Error('Khmer narration has no audible speech.');
    const fullDuration = pcm.length / (SAMPLE_RATE * 2);
    const start = Math.max(0, firstActive * 0.01 - 0.06);
    const end = Math.min(fullDuration, (lastActive + 1) * 0.01 + 0.12);
    if (start < 0.08 && fullDuration - end < 0.18) return audio;
    await run(ffmpegPath, ['-v', 'error', '-nostdin', '-y', '-i', source,
      '-af', `atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS`,
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-b:a', '96k', outputPath],
    { timeout: 30000, windowsHide: true });
    const trimmed = await readFile(outputPath);
    const metadata = await parseBuffer(trimmed, { mimeType: 'audio/mpeg' }, { duration: true });
    const duration = Number(metadata.format.duration);
    if (!trimmed.length || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not measure trimmed Khmer narration.');
    }
    return { ...audio, audioUrl: `data:audio/mpeg;base64,${trimmed.toString('base64')}`, duration };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
