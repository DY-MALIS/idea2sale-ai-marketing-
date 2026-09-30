// Gemini Live (Google's realtime bidirectional audio API) lets one model listen,
// think, and speak over a single open connection instead of the
// transcribe -> generate-text -> synthesize-speech round trip the rest of this
// app uses, which is why it answers in ~0.5-1s instead of ~5-6s. The browser
// connects to Google's WebSocket directly (so mic audio never has to hop
// through this server first) -- but that means the real GEMINI_API_KEY can
// never be sent to the browser. Google's ephemeral "auth token" API solves
// this: the server mints a short-lived, single-use token, and only that token
// (not the real key) reaches the phone. When supported, it also constrains the
// model and voice config at issuance.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

const getGeminiApiKey = () => {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY is not configured on the server.');
  return key;
};

// The model name a working Gemini Live account actually has access to varies
// by account/region and changes as Google promotes preview models to GA --
// GEMINI_LIVE_MODEL lets an operator override this without a code change if
// the default below isn't available on their key.
const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';

export async function createGeminiLiveEphemeralToken({ voiceName = 'Aoede', systemInstruction = '' } = {}) {
  const key = getGeminiApiKey();
  const model = (process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL).trim().replace(/^models\//, '');
  const now = Date.now();
  const tokenConfig = {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
  };
  const requestToken = (body) => fetch(`${GEMINI_BASE_URL}/v1beta/auth_tokens`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  let response = await requestToken({
    ...tokenConfig,
    liveConnectConstraints: {
      model: `models/${model}`,
      config: {
        responseModalities: ['AUDIO'],
      },
    },
  });
  // Some Gemini deployments reject this documented preview constraint field.
  // A one-use token is still usable for Live, with the same voice and system
  // instruction sent in the WebSocket setup message instead.
  if (response.status === 400) {
    const validationError = await response.clone().text().catch(() => '');
    if (/Unknown name.*liveConnectConstraints/i.test(validationError)) {
      response = await requestToken(tokenConfig);
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini ephemeral token request failed (${response.status}): ${errorText.slice(0, 400)}`);
  }
  const data = await response.json();
  // Different API revisions have returned the usable token under either field;
  // accept whichever is present rather than guessing one and breaking silently
  // the day Google renames it.
  const token = data?.token || data?.name;
  if (!token) throw new Error('Gemini did not return an ephemeral token.');
  return { token, model, voiceName, systemInstruction };
}
