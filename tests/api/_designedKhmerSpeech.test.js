import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDesignedKhmerSpeech } from '../../api/_designedKhmerSpeech.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const oneSecondWav = () => {
  const bytes = Buffer.alloc(44 + 48_000);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24_000, 24); bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(48_000, 40);
  return bytes;
};

describe('designed Cambodian Khmer speech', () => {
  it('uses the Khmer voice ID and returns measured WAV audio', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const wav = oneSecondWav();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateDesignedKhmerSpeech({ input: 'សួស្តី', voice: 'Female' });
    const [url, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toContain('/v1beta/interactions');
    expect(body.input[0].content[0].text).toBe('សួស្តី');
    expect(body.generation_config.speech_config[0].voice).toBe('voice_q7mab84kw5w8');
    expect(result).toMatchObject({ provider: 'gemini-designed', duration: 1 });
    expect(result.audioUrl).toMatch(/^data:audio\/wav;base64,/);
  });

  it('requires the server key before contacting Google', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateDesignedKhmerSpeech({ input: 'សួស្តី' })).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
