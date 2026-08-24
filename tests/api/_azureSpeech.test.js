import { afterEach, describe, expect, it, vi } from 'vitest';
import { synthesizeKhmerSpeechViaAzure } from '../../api/_azureSpeech.js';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const mockAudioBytes = () => new Uint8Array([1, 2, 3, 4]).buffer;

describe('synthesizeKhmerSpeechViaAzure', () => {
  it('throws without hitting the network when Azure is not configured', async () => {
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    await expect(synthesizeKhmerSpeechViaAzure({ input: 'សួស្តី' })).rejects.toThrow('not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Each test below uses its own fake region string -- the module caches the
  // auth token keyed by region across calls (by design, to avoid re-issuing a
  // token per request), so reusing the same region between tests would let an
  // earlier test's cached token leak in and skip the token-fetch call this
  // test expects.
  it('fetches a token then returns synthesized audio as a data URL', async () => {
    process.env.AZURE_SPEECH_KEY = 'fake-key';
    process.env.AZURE_SPEECH_REGION = 'region-a';

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => 'fake-token' })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => mockAudioBytes() });
    global.fetch = fetchSpy;

    const result = await synthesizeKhmerSpeechViaAzure({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural' });

    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
    expect(result.model).toBe('azure-km-KH-SreymomNeural');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [ttsUrl, ttsOptions] = fetchSpy.mock.calls[1];
    expect(ttsUrl).toContain('region-a.tts.speech.microsoft.com');
    expect(ttsOptions.body).toContain('km-KH-SreymomNeural');
    expect(ttsOptions.body).toContain('សួស្តី');
  });

  it('retries once with a fresh token on a 401, then succeeds', async () => {
    process.env.AZURE_SPEECH_KEY = 'fake-key';
    process.env.AZURE_SPEECH_REGION = 'region-b';

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => 'stale-token' })
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'expired' })
      .mockResolvedValueOnce({ ok: true, text: async () => 'fresh-token' })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => mockAudioBytes() });
    global.fetch = fetchSpy;

    const result = await synthesizeKhmerSpeechViaAzure({ input: 'សួស្តី' });

    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('throws a redacted error on a non-recoverable failure', async () => {
    process.env.AZURE_SPEECH_KEY = 'fake-key';
    process.env.AZURE_SPEECH_REGION = 'region-c';

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => 'fake-token' })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'Bad SSML' });
    global.fetch = fetchSpy;

    await expect(synthesizeKhmerSpeechViaAzure({ input: 'សួស្តី' })).rejects.toThrow('400');
  });
});
