import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ edge: vi.fn(), translate: vi.fn(), text: vi.fn() }));
vi.mock('../../api/_edgeSpeech.js', () => ({ synthesizeKhmerSpeechViaEdge: mocks.edge }));
vi.mock('../../api/_openrouter.js', () => ({ generateTranslateSpeech: mocks.translate, generateOpenRouterText: mocks.text }));
import { createKhmerNarration, generateKhmerSpeech, replaceCloudinaryAudio } from '../../api/_khmerNarration.js';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('Khmer narration', () => {
  it('uses the Edge male Khmer voice for a male selection', async () => {
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', voice: 'onyx' })).toEqual({ audioUrl: 'khmer' });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-PisethNeural', rate: '+20%' });
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('uses the Edge female Khmer voice by default', async () => {
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', performanceStyle: 'warm', context: 'training' })).toMatchObject({ audioUrl: 'khmer', provider: 'edge' });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural', rate: '+20%' });
  });
  it('surfaces Edge failure instead of silently changing providers', async () => {
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
