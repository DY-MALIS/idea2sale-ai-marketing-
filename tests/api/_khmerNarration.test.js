import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ azure: vi.fn(), translate: vi.fn(), text: vi.fn(), gemini: vi.fn() }));
vi.mock('../../api/_geminiSpeech.js', () => ({ generateGeminiSpeech: mocks.gemini }));
vi.mock('../../api/_azureSpeech.js', () => ({ synthesizeKhmerSpeechViaAzure: mocks.azure }));
vi.mock('../../api/_openrouter.js', () => ({ generateTranslateSpeech: mocks.translate, generateOpenRouterText: mocks.text }));
import { createKhmerNarration, generateKhmerSpeech, replaceCloudinaryAudio } from '../../api/_khmerNarration.js';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('Khmer narration', () => {
  it('uses Gemini with the selected voice even when Azure is configured', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'test'); vi.stubEnv('AZURE_SPEECH_REGION', 'test');
    mocks.gemini.mockResolvedValue({ audioUrl: 'khmer' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', voice: 'onyx' })).toEqual({ audioUrl: 'khmer' });
    expect(mocks.gemini).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'onyx', context: '', performanceStyle: '' });
    expect(mocks.azure).not.toHaveBeenCalled();
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('passes performance directions to Gemini', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', ''); vi.stubEnv('AZURE_SPEECH_REGION', '');
    mocks.gemini.mockResolvedValue({ audioUrl: 'khmer', provider: 'gemini' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', performanceStyle: 'warm', context: 'training' })).toMatchObject({ audioUrl: 'khmer', provider: 'gemini' });
    expect(mocks.gemini).toHaveBeenCalledWith(expect.objectContaining({performanceStyle:'warm',context:'training'}));
  });
  it('surfaces Gemini failure instead of silently changing providers', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'test'); vi.stubEnv('AZURE_SPEECH_REGION', 'test');
    mocks.gemini.mockRejectedValue(new Error('auth failed'));
    await expect(generateKhmerSpeech({ input: 'សួស្តី' })).rejects.toThrow('auth failed');
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('rejects generated scripts in the wrong language', async () => {
    mocks.text.mockResolvedValue('Hello');
    await expect(createKhmerNarration('product')).rejects.toThrow('Khmer narration');
  });
  it('removes native speech before adding the uploaded Khmer track', () => {
    expect(replaceCloudinaryAudio('https://res.cloudinary.com/demo/video/upload/v1/test.mp4', 'telegram-media/voice'))
      .toBe('https://res.cloudinary.com/demo/video/upload/ac_none/l_audio:telegram-media:voice/fl_layer_apply/v1/test.mp4');
    expect(() => replaceCloudinaryAudio('https://example.com/a.mp4', 'voice')).toThrow();
  });
});
