import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiLiveEphemeralToken } from '../../api/_geminiLive.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Gemini Live ephemeral token', () => {
  it('uses the constrained v1beta token API and locks the audio model', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'server-test-key');
    vi.stubEnv('GEMINI_LIVE_MODEL', 'models/gemini-3.8-live');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'short-lived-token' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createGeminiLiveEphemeralToken({ voiceName: 'Aoede', systemInstruction: 'Talk naturally.' });
    expect(result).toMatchObject({ token: 'short-lived-token', model: 'gemini-3.8-live', voiceName: 'Aoede', systemInstruction: 'Talk naturally.' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    expect(options.headers['x-goog-api-key']).toBe('server-test-key');
    const body = JSON.parse(options.body);
    expect(body.uses).toBe(1);
    expect(body.liveConnectConstraints).toMatchObject({
      model: 'models/gemini-3.8-live',
      config: {
        responseModalities: ['AUDIO'],
      },
    });
  });

  it('retries a one-use token when the provider rejects preview constraints', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'server-test-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        clone: () => ({ text: async () => 'Unknown name "liveConnectConstraints" at auth_token' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'short-lived-token' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createGeminiLiveEphemeralToken({ systemInstruction: 'Talk naturally.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ uses: 1 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('liveConnectConstraints');
    expect(result).toMatchObject({ token: 'short-lived-token', systemInstruction: 'Talk naturally.' });
  });
});
