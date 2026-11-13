import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { generateKiriSpeech } from '../../api/_kiriSpeech.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Kiri speech adapter', () => {
  it('requests a natural Khmer voice and measures the returned MP3', async () => {
    vi.stubEnv('KIRI_API_KEY', 'test-key');
    const audio = await readFile(new URL('../../artifacts/khmer-speech-smoke-current.mp3', import.meta.url));
    const fetchMock = vi.fn().mockResolvedValue(new Response(audio, { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateKiriSpeech({ input: 'សួស្តី', voice: 'Male' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.kiritts.com/v1/audio/speech');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(options.body)).toMatchObject({ model: 'kiritts', voice: 'Oudom', response_format: 'mp3', voice_matching: 'natural' });
    expect(result).toMatchObject({ provider: 'kiri-tts', voice: 'Oudom' });
    expect(result.duration).toBeGreaterThan(0);
    expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
  });

  it('does not contact Kiri without a server-side key', async () => {
    vi.stubEnv('KIRI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateKiriSpeech({ input: 'សួស្តី' })).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
