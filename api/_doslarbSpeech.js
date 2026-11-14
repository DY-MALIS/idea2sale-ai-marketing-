import { parseBuffer } from 'music-metadata';

const ENDPOINT = 'https://doslarb.cloud/api/v1/tts';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export const isDoslarbConfigured = () => Boolean(String(process.env.DOSLARB_API_KEY || '').trim());

export async function generateDoslarbSpeech({ input, voice = 'Female' }) {
  const key = String(process.env.DOSLARB_API_KEY || '').trim();
  if (!key) throw new Error('DOSLARB_API_KEY is not configured on the server.');
  const text = String(input || '').trim();
  if (!text || [...text].length > 1200) throw new Error('Speech text must contain 1–1200 characters.');
  const male = ['male', 'onyx', 'echo', 'piseth', 'sovann'].includes(String(voice).trim().toLowerCase());
  const selectedVoice = male ? 'sovann' : 'puthi';
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: selectedVoice }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Doslarb Khmer speech failed (HTTP ${response.status}).`);
  if (!/^audio\/mpeg(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new Error('Doslarb returned unsupported audio.');
  }
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_AUDIO_BYTES) throw new Error('Doslarb audio exceeds the size limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES
    || !(bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
    throw new Error('Doslarb returned invalid MP3 audio.');
  }
  const headerDuration = Number(response.headers.get('x-audio-duration-seconds'));
  const duration = headerDuration > 0 ? headerDuration : Number((await parseBuffer(
    bytes, { mimeType: 'audio/mpeg' }, { duration: true },
  )).format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Doslarb audio has no measurable duration.');
  return { audioUrl: `data:audio/mpeg;base64,${bytes.toString('base64')}`, duration,
    provider: 'doslarb', voice: selectedVoice };
}
