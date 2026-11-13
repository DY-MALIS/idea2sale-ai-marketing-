import { parseBuffer } from 'music-metadata';

const KIRI_SPEECH_URL = 'https://api.kiritts.com/v1/audio/speech';
const MAX_INPUT_CHARS = 4096;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export const isKiriConfigured = () => Boolean(String(process.env.KIRI_API_KEY || '').trim());

export async function generateKiriSpeech({ input, voice = 'Female', instructions = '' }) {
  const key = String(process.env.KIRI_API_KEY || '').trim();
  if (!key) throw new Error('Kiri TTS API key is not configured.');
  const text = String(input || '').trim();
  if (!text || Array.from(text).length > MAX_INPUT_CHARS) throw new Error('Kiri TTS requires 1 to 4096 characters of text.');
  const male = ['male', 'onyx', 'echo'].includes(String(voice).toLowerCase());
  const selectedVoice = male
    ? (process.env.KIRI_TTS_MALE_VOICE || 'Oudom')
    : (process.env.KIRI_TTS_FEMALE_VOICE || 'Maly');
  const response = await fetch(KIRI_SPEECH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kiritts',
      input: text,
      voice: selectedVoice,
      response_format: 'mp3',
      instructions: String(instructions || 'Speak clear Cambodian Khmer with a warm, natural conversational rhythm.').slice(0, 100),
      voice_matching: 'natural',
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Kiri TTS request failed (HTTP ${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/audio\/(?:mpeg|mp3|x-mpeg|octet-stream)|application\/octet-stream/i.test(contentType)) {
    throw new Error('Kiri TTS returned a non-audio response.');
  }
  const declaredBytes = Number(response.headers.get('content-length'));
  if (declaredBytes > MAX_AUDIO_BYTES) throw new Error('Kiri TTS audio exceeded the size limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error('Kiri TTS returned empty or oversized audio.');
  const metadata = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true });
  const duration = Number(metadata.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Kiri TTS returned audio without a measurable duration.');
  return {
    audioUrl: `data:audio/mpeg;base64,${bytes.toString('base64')}`,
    duration,
    provider: 'kiri-tts',
    model: 'kiritts',
    voice: selectedVoice,
  };
}
