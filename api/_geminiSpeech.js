import { redactSecrets } from './_openrouter.js';

export async function generateGeminiSpeech({ input, voice = 'alloy', performanceStyle = '', context = '' }) {
  const key = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPEN_ROUTER_API_KEY is not configured on the server.');
  const text = String(input || '').trim();
  if (!text || text.length > 5000) throw new Error('Speech text must contain 1–5000 characters.');
  const model = process.env.OPEN_ROUTER_TTS_GEMINI_MODEL || 'google/gemini-3.1-flash-tts-preview';
  if (!/^google\/gemini-[\w.-]+-tts(?:-preview)?$/.test(model)) throw new Error('Invalid OpenRouter Gemini TTS model configuration.');
  const voiceName = ['onyx', 'echo', 'ash', 'ballad', 'Charon'].includes(voice) ? 'Charon' : 'Kore';
  const style = String(performanceStyle).trim()
    || 'Warm, clear conversational delivery at a normal, brisk everyday speaking speed -- like talking to a friend, not reciting slowly or dragging out words -- with crisp, distinct enunciation of every Khmer syllable so each word is still easy to make out.';
  const prompt = `Read only the SCRIPT verbatim, in its original language. If Khmer, speak Cambodian Khmer; do not translate or transliterate the text. Do not read the directions or context aloud. Use a warm human conversational delivery, varied intonation, gentle emphasis on meaningful words, and a clear settled ending. Speak at a normal, natural everyday pace -- do not slow down, drag out words, or add long pauses, but also do not rush or garble words. Follow the meaning of the script rather than exaggerating every phrase.\nDelivery direction: ${style.slice(0, 1500)}\nPlan context (context only, never spoken): ${JSON.stringify(String(context).slice(0, 3000))}\nSCRIPT:\n${text}`;
  const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST', signal: AbortSignal.timeout(50000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    // Gemini accepts delivery directions in its input prompt. Do not send
    // OpenAI-only instructions parameters to the Google provider.
    body: JSON.stringify({ model, input: prompt, voice: voiceName, response_format: 'pcm' }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => 'Provider error');
    throw new Error(redactSecrets(`OpenRouter Gemini TTS failed (${response.status}): ${message.replaceAll(key, '[redacted]').slice(0, 400)}`));
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/^audio\/(?:pcm|L16)(?:;|$)/i.test(contentType)) throw new Error('Unsupported OpenRouter Gemini audio format.');
  // Gemini PCM is mono signed 16-bit at 24 kHz; honor an explicit rate header.
  const rates = [Number(contentType.match(/rate=(\d+)/)?.[1] || 24000)];
  if (rates[0] < 8000 || rates[0] > 48000) throw new Error('Unsupported Gemini sample rate.');
  const pcm = Buffer.from(await response.arrayBuffer());
  if (!pcm.length || pcm.length % 2) throw new Error('Invalid Gemini PCM audio.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rates[0], 24); header.writeUInt32LE(rates[0] * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return { audioUrl: `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString('base64')}`, duration: pcm.length / (rates[0] * 2), provider: 'gemini', gateway: 'openrouter', generationId: response.headers.get('x-generation-id'), model, voice: voiceName };
}
