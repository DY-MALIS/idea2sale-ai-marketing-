const DEFAULT_MODEL = 'gemini-2.5-flash';

// A second opinion for Khmer audio when Chirp returns another script or a
// mismatching transcript. Never include the expected script in this request:
// the verifier must hear the audio rather than guess what it should say.
export async function transcribeKhmerSpeechWithGemini(audioUrl) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return '';
  const match = /^data:audio\/(wav|mpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(audioUrl || ''));
  if (!match || match[2].length > 12 * 1024 * 1024) return '';
  const model = process.env.GEMINI_STT_MODEL || DEFAULT_MODEL;
  if (!/^gemini-[\w.-]+$/.test(model)) return '';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'Transcribe the speech in this audio exactly, in its original language and script. Return only the transcript.' },
        { inline_data: { mime_type: match[1] === 'wav' ? 'audio/wav' : 'audio/mpeg', data: match[2] } },
      ] }],
    }),
  });
  if (!response.ok) throw new Error(`Gemini speech transcription failed (HTTP ${response.status}).`);
  const result = await response.json();
  return String(result?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ') || '').trim();
}
