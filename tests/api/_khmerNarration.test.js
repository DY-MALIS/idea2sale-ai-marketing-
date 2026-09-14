import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ edge: vi.fn(), gemini: vi.fn(), translate: vi.fn(), text: vi.fn() }));
vi.mock('../../api/_edgeSpeech.js', () => ({ synthesizeKhmerSpeechViaEdge: mocks.edge }));
vi.mock('../../api/_geminiSpeech.js', () => ({ generateGeminiSpeech: mocks.gemini }));
vi.mock('../../api/_openrouter.js', () => ({ generateTranslateSpeech: mocks.translate, generateOpenRouterText: mocks.text }));
import { createKhmerNarration, generateKhmerSpeech, replaceCloudinaryAudio } from '../../api/_khmerNarration.js';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('Khmer narration', () => {
  it('uses expressive Gemini speech first and preserves delivery direction', async () => {
    mocks.gemini.mockResolvedValue({ audioUrl: 'natural-khmer', provider: 'gemini' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', voice: 'onyx', performanceStyle: 'warm', context: 'training' }))
      .toEqual({ audioUrl: 'natural-khmer', provider: 'gemini' });
    expect(mocks.gemini).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'onyx', performanceStyle: 'warm', context: 'training' });
    expect(mocks.edge).not.toHaveBeenCalled();
  });

  it('falls back to a natural-speed Edge female Khmer voice', async () => {
    mocks.gemini.mockRejectedValue(new Error('provider unavailable'));
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', performanceStyle: 'warm', context: 'training' })).toMatchObject({
      audioUrl: 'khmer',
      provider: 'edge',
      fallbackReason: expect.any(String),
    });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural', rate: '+8%' });
  });

  it('keeps the requested male voice when Gemini falls back to Edge', async () => {
    mocks.gemini.mockRejectedValue(new Error('provider unavailable'));
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    await generateKhmerSpeech({ input: 'សួស្តី', voice: 'onyx' });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-PisethNeural', rate: '+8%' });
  });

  it('surfaces failure when both expressive and fallback voices fail', async () => {
    mocks.gemini.mockRejectedValue(new Error('provider unavailable'));
    mocks.edge.mockRejectedValue(new Error('auth failed'));
    await expect(generateKhmerSpeech({ input: 'សួស្តី' })).rejects.toThrow('auth failed');
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('rejects generated scripts in the wrong language', async () => {
    mocks.text.mockResolvedValue('Hello');
    await expect(createKhmerNarration('product')).rejects.toThrow('Khmer narration');
  });
  it('requests a fuller 8-second narration instead of a short hook', async () => {
    mocks.text.mockResolvedValue('\u1780');
    await createKhmerNarration('competitor research', 8, 'DGACADEMY');
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('aiming for 64-84 total characters'),
    }));
    expect(mocks.text.mock.calls[0][0].prompt).toContain('two connected short clauses');
    expect(mocks.text.mock.calls[0][0].prompt).toContain('DGACADEMY');
  });
  it('removes native speech before adding the uploaded Khmer track', () => {
    expect(replaceCloudinaryAudio('https://res.cloudinary.com/demo/video/upload/v1/test.mp4', 'telegram-media/voice'))
      .toBe('https://res.cloudinary.com/demo/video/upload/ac_none/l_audio:telegram-media:voice/fl_layer_apply/v1/test.mp4');
    expect(() => replaceCloudinaryAudio('https://example.com/a.mp4', 'voice')).toThrow();
  });
});
