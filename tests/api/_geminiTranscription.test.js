import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeKhmerSpeechWithGemini } from '../../api/_geminiTranscription.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Gemini Khmer speech second opinion', () => {
  it('sends only the audio and no expected script', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'សួស្តី' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const transcript = await transcribeKhmerSpeechWithGemini('data:audio/wav;base64,YXVkaW8=');
    expect(transcript).toBe('សួស្តី');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(request.headers['x-goog-api-key']).toBe('test-key');
    const parts = JSON.parse(request.body).contents[0].parts;
    expect(parts[1].inline_data).toMatchObject({ mime_type: 'audio/wav', data: 'YXVkaW8=' });
    expect(JSON.stringify(parts)).not.toContain('សួស្តី');
  });

  it('skips the network when the server has no Google key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribeKhmerSpeechWithGemini('data:audio/wav;base64,YXVkaW8=')).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
