// Azure Cognitive Services Speech has dedicated Neural voices for Khmer
// (km-KH-SreymomNeural / km-KH-PisethNeural) that speak Khmer naturally --
// unlike every OpenRouter audio model, which either errors out on Khmer
// script (Gemini TTS) or hallucinates a confused reply in the wrong language
// instead of reading it (gpt-audio / gpt-audio-mini, confirmed via live
// testing). This is the only tier that produces genuinely natural Khmer
// speech; api/ai.js falls back to the older OpenRouter/Google-Translate
// chain when this isn't configured or fails.
import { redactSecrets } from './_openrouter.js';

// Azure's issued auth tokens are valid for 10 minutes; refreshing a minute
// early avoids a request racing the exact expiry instant.
const TOKEN_TTL_MS = 9 * 60 * 1000;
let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedTokenRegion = null;

const fileToDataUrl = (base64, mimeType) => `data:${mimeType};base64,${base64}`;

const escapeSsml = (text) => String(text || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

async function getAzureAccessToken(region, key) {
  if (cachedToken && cachedTokenRegion === region && Date.now() < cachedTokenExpiry) {
    return cachedToken;
  }
  const response = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
  });
  if (!response.ok) {
    throw new Error(redactSecrets(`Azure Speech auth failed with status ${response.status}.`));
  }
  cachedToken = await response.text();
  cachedTokenExpiry = Date.now() + TOKEN_TTL_MS;
  cachedTokenRegion = region;
  return cachedToken;
}

export async function synthesizeKhmerSpeechViaAzure({ input, voice = 'km-KH-SreymomNeural', _retried = false }) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error('Azure Speech is not configured.');

  const token = await getAzureAccessToken(region, key);
  const ssml = `<speak version="1.0" xml:lang="km-KH"><voice name="${voice}">${escapeSsml(input)}</voice></speak>`;

  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'idea2sale-ai-marketing',
    },
    body: ssml,
  });

  if (!response.ok) {
    // A cached token can expire between the freshness check above and this
    // call landing; retry exactly once with a forced-fresh token before
    // surfacing the error.
    if (response.status === 401 && !_retried) {
      cachedToken = null;
      return synthesizeKhmerSpeechViaAzure({ input, voice, _retried: true });
    }
    const errorText = await response.text().catch(() => '');
    throw new Error(redactSecrets(`Azure Speech request failed with status ${response.status}. ${errorText}`.trim()));
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  return {
    audioUrl: fileToDataUrl(base64, 'audio/mpeg'),
    transcript: input,
    model: `azure-${voice}`,
  };
}
