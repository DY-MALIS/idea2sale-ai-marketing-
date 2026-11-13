import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { generateKiriSpeech } from '../../api/_kiriSpeech.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Kiri speech adapter', () => {
  it('sends Khmer text server-side and returns measured MP3 audio for video muxing', async () => {
    vi.stubEnv('KIRI_API_KEY', 'test-key');
    const audio = await readFile(new URL('../../artifacts/khmer-speech-smoke-current.mp3', import.meta.url));
    const fetchMock = vi.fn().mockResolvedValue(new Response(audio, { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateKiriSpeech({ input: '\u179f\u17bd\u179f\u17d2\u178f\u17b8', voice: 'Male' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.kiritts.com/v1/audio/speech');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(options.body)).toMatchObject({ model: 'kiritts', voice: 'Oudom', response_format: 'mp3' });
    expect(result).toMatchObject({ provider: 'kiri-tts', model: 'kiritts', voice: 'Oudom' });
    expect(result.duration).toBeGreaterThan(0);
    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
  });

  it('does not make a network request without a server-side key', async () => {
    vi.stubEnv('KIRI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateKiriSpeech({ input: '\u179f\u17bd\u179f\u17d2\u178f\u17b8' })).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-audio responses without returning or logging provider text', async () => {
    vi.stubEnv('KIRI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"bad"}', { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(generateKiriSpeech({ input: '\u179f\u17bd\u179f\u17d2\u178f\u17b8' })).rejects.toThrow('non-audio');
  });
});
