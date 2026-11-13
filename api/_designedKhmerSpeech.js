import { parseBuffer } from 'music-metadata';

const MODEL = 'gemini-3.8-flash-tts';
// Designed for this project's Cambodian Khmer narration. These IDs contain no
// credentials; GEMINI_API_KEY stays on the server and can be changed there.
const DEFAULT_FEMALE_VOICE = 'voice_3mngnu3sw8h0';
const DEFAULT_MALE_VOICE = 'voice_ihzgs4v87qjm';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export const isDesignedKhmerSpeechConfigured = () => Boolean(String(process.env.GEMINI_API_KEY || '').trim());

export async function generateDesignedKhmerSpeech({ input, voice = 'Female', performanceStyle = '' }) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('Gemini voice design key is not configured.');
  const text = String(input || '').trim();
  if (!text || text.length > 5000) throw new Error('Khmer speech text must contain 1–5000 characters.');
  const male = ['male', 'onyx', 'echo'].includes(String(voice).trim().toLowerCase());
  const voiceId = male
    ? (process.env.GEMINI_KHMER_MALE_VOICE_ID || DEFAULT_MALE_VOICE)
    : (process.env.GEMINI_KHMER_FEMALE_VOICE_ID || DEFAULT_FEMALE_VOICE);
  if (!/^voice_[A-Za-z0-9_-]+$/.test(voiceId)) throw new Error('Invalid Gemini Khmer voice ID.');
  const style = String(performanceStyle || '').trim().slice(0, 160);
  const part = { type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) };
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: MODEL,
      input: [{ type: 'user_input', content: [part] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: voiceId }] },
    }),
  });
  if (!response.ok) throw new Error(`Gemini designed Khmer speech failed (HTTP ${response.status}).`);
  const result = await response.json();
  const audio = [...(result?.steps || [])].reverse()
    .flatMap((step) => step.content || [])
    .find((content) => content.type === 'audio' && content.data);
  if (audio?.mime_type !== 'audio/wav' || !audio.data) throw new Error('Gemini designed voice returned no WAV audio.');
  const bytes = Buffer.from(audio.data, 'base64');
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Gemini designed voice returned invalid WAV audio.');
  }
  const metadata = await parseBuffer(bytes, { mimeType: 'audio/wav' }, { duration: true });
  const duration = Number(metadata.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Gemini designed voice returned audio without measurable duration.');
  return { audioUrl: `data:audio/wav;base64,${bytes.toString('base64')}`, duration,
    provider: 'gemini-designed', model: MODEL, voice: voiceId };
}
