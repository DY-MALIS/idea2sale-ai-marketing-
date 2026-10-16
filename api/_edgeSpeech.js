import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeTTS } from 'node-edge-tts';
import { parseBuffer } from 'music-metadata';

const KHMER_VOICES = new Set(['km-KH-SreymomNeural', 'km-KH-PisethNeural']);

// Microsoft's endpoint can reject with 429 (rate-limited) rather than 403
// (rejected outright) -- seen in production right after the Oct 2026
// endpoint migration (see package.json's node-edge-tts version), where the
// new endpoint appears to enforce a tighter per-token limit shared by every
// deployment of this unofficial client, not just this app's own traffic.
// Unlike a 403, a 429 means "try again shortly" and has been observed to
// clear within about a second -- one short retry is cheap next to the cost
// of falling all the way through to the Gemini fallback (two syntheses plus
// up to four verification calls) over a limit that was about to reset anyway.
const RATE_LIMITED_PATTERN = /response: 429/i;
const RETRY_DELAY_MS = 1200;
const MAX_ATTEMPTS = 2;

const synthesizeOnce = async ({ input, voice, rate }) => {
  const audioPath = join(tmpdir(), `aime-khmer-${randomUUID()}.mp3`);
  const tts = new EdgeTTS({
    voice,
    lang: 'km-KH',
    rate,
    pitch: 'default',
    volume: '+10%',
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    timeout: 30000,
  });

  try {
    await tts.ttsPromise(String(input), audioPath);
    const audio = await readFile(audioPath);
    if (!audio.length) throw new Error('Edge TTS returned empty audio.');
    const metadata = await parseBuffer(audio, { mimeType: 'audio/mpeg' }, { duration: true });
    const duration = Number(metadata.format.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not measure Khmer narration duration.');
    return {
      audioUrl: `data:audio/mpeg;base64,${audio.toString('base64')}`,
      duration,
      transcript: input,
      model: `edge-${voice}`,
    };
  } finally {
    await unlink(audioPath).catch(() => {});
  }
};

export async function synthesizeKhmerSpeechViaEdge({ input, voice = 'km-KH-SreymomNeural', rate = '+0%' }) {
  if (!/[\u1780-\u17ff]/u.test(input || '')) throw new Error('Khmer narration text is required.');
  if (!KHMER_VOICES.has(voice)) throw new Error('Unsupported Edge Khmer voice.');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await synthesizeOnce({ input, voice, rate });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS || !RATE_LIMITED_PATTERN.test(error?.message || '')) throw error;
      console.warn(`Edge TTS rate-limited (429); retrying once in ${RETRY_DELAY_MS}ms.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
