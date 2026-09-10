import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeTTS } from 'node-edge-tts';

const KHMER_VOICES = new Set(['km-KH-SreymomNeural', 'km-KH-PisethNeural']);

export async function synthesizeKhmerSpeechViaEdge({ input, voice = 'km-KH-SreymomNeural', rate = '+20%' }) {
  if (!/[\u1780-\u17ff]/u.test(input || '')) throw new Error('Khmer narration text is required.');
  if (!KHMER_VOICES.has(voice)) throw new Error('Unsupported Edge Khmer voice.');

  const audioPath = join(tmpdir(), `aime-khmer-${randomUUID()}.mp3`);
  const tts = new EdgeTTS({
    voice,
    lang: 'km-KH',
    rate,
    pitch: 'default',
    volume: 'default',
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    timeout: 30000,
  });

  try {
    await tts.ttsPromise(String(input), audioPath);
    const audio = await readFile(audioPath);
    if (!audio.length) throw new Error('Edge TTS returned empty audio.');
    return {
      audioUrl: `data:audio/mpeg;base64,${audio.toString('base64')}`,
      transcript: input,
      model: `edge-${voice}`,
    };
  } finally {
    await unlink(audioPath).catch(() => {});
  }
}
