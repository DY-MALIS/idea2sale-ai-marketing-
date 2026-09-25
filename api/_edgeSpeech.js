import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeTTS } from 'node-edge-tts';
import { parseBuffer } from 'music-metadata';

const KHMER_VOICES = new Set(['km-KH-SreymomNeural', 'km-KH-PisethNeural']);

export async function synthesizeKhmerSpeechViaEdge({ input, voice = 'km-KH-SreymomNeural', rate = '+0%' }) {
  if (!/[\u1780-\u17ff]/u.test(input || '')) throw new Error('Khmer narration text is required.');
  if (!KHMER_VOICES.has(voice)) throw new Error('Unsupported Edge Khmer voice.');

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
}
