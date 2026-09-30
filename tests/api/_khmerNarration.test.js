import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ edge: vi.fn(), gemini: vi.fn(), transcribe: vi.fn(), translate: vi.fn(), text: vi.fn() }));
vi.mock('../../api/_edgeSpeech.js', () => ({ synthesizeKhmerSpeechViaEdge: mocks.edge }));
vi.mock('../../api/_geminiSpeech.js', () => ({ generateGeminiSpeech: mocks.gemini }));
vi.mock('../../api/_openrouter.js', () => ({
  generateTranslateSpeech: mocks.translate,
  generateOpenRouterText: mocks.text,
  transcribeAudioWithOpenRouter: mocks.transcribe,
  normalizeForKhmerSpeech: (text) => String(text).normalize('NFC').trim(),
}));
import { createKhmerNarration, generateKhmerSpeech } from '../../api/_khmerNarration.js';
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('Khmer narration', () => {
  beforeEach(() => { vi.stubEnv('KHMER_TTS_PROVIDER', 'gemini'); });
  it.each(['', 'edge', 'unknown'])('uses Khmer-specific speech without Gemini opt-in (%s)', async (provider) => {
    vi.stubEnv('KHMER_TTS_PROVIDER', provider);
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    const result = await generateKhmerSpeech({ input: 'សួស្តី', voice: 'Female' });
    expect(result).toMatchObject({ audioUrl: 'khmer', spokenText: 'សួស្តី', fallbackReason: '' });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural', rate: '+6%' });
    expect(mocks.gemini).not.toHaveBeenCalled();
  });
  it('does not replace a failed Khmer voice with unchecked generative speech', async () => {
    vi.stubEnv('KHMER_TTS_PROVIDER', '');
    mocks.edge.mockRejectedValue(new Error('voice unavailable'));
    await expect(generateKhmerSpeech({ input: 'សួស្តី' })).rejects.toThrow('voice unavailable');
    expect(mocks.gemini).not.toHaveBeenCalled();
  });
  it('plays a natural Agent voice only after its Khmer words are verified', async () => {
    vi.stubEnv('KHMER_TTS_PROVIDER', '');
    const script = '\u179f\u17bd\u179f\u17d2\u178f\u17b8';
    mocks.gemini.mockResolvedValue({ audioUrl: 'data:audio/wav;base64,YXVkaW8=', provider: 'gemini' });
    mocks.transcribe.mockResolvedValue(script);
    const result = await generateKhmerSpeech({ input: script, preferNaturalVoice: true, edgeRate: '+0%' });
    expect(result).toMatchObject({ provider: 'gemini', spokenText: script });
    expect(mocks.transcribe).toHaveBeenCalledWith({
      audioBase64: 'YXVkaW8=', format: 'wav', languageHint: 'Khmer', model: 'google/chirp-3',
    });
    expect(mocks.gemini.mock.calls[0][0].performanceStyle).toContain('relaxed conversation');
    expect(mocks.edge).not.toHaveBeenCalled();
  });
  it('uses a clear Khmer voice if the expressive Agent read says different words', async () => {
    vi.stubEnv('KHMER_TTS_PROVIDER', '');
    const script = '\u179f\u17bd\u179f\u17d2\u178f\u17b8';
    mocks.gemini.mockResolvedValue({ audioUrl: 'data:audio/wav;base64,YXVkaW8=', provider: 'gemini' });
    mocks.transcribe.mockResolvedValue('Hello');
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    const result = await generateKhmerSpeech({ input: script, preferNaturalVoice: true, edgeRate: '+0%' });
    expect(result).toMatchObject({ provider: 'edge', spokenText: script, fallbackReason: expect.stringContaining('unclear') });
    expect(mocks.edge).toHaveBeenCalledWith({ input: script, voice: 'km-KH-SreymomNeural', rate: '+0%' });
  });
  it('uses expressive Gemini speech first and preserves delivery direction', async () => {
    mocks.gemini.mockResolvedValue({ audioUrl: 'natural-khmer', provider: 'gemini' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', voice: 'onyx', performanceStyle: 'warm', context: 'training' }))
      .toMatchObject({ audioUrl: 'natural-khmer', provider: 'gemini', spokenText: 'សួស្តី' });
    expect(mocks.gemini).toHaveBeenCalledWith(expect.objectContaining({
      input: 'សួស្តី', voice: 'onyx', performanceStyle: expect.stringContaining('crisp initial and final consonants'), context: 'training',
    }));
    expect(mocks.edge).not.toHaveBeenCalled();
  });

  it('asks the voice to preserve every word while fitting the target clip', async () => {
    mocks.gemini.mockResolvedValue({ audioUrl: 'natural-khmer', provider: 'gemini' });
    await generateKhmerSpeech({ input: 'សួស្តី', targetDuration: 6 });
    expect(mocks.gemini.mock.calls[0][0].performanceStyle).toContain('within 5.85 seconds');
    expect(mocks.gemini.mock.calls[0][0].performanceStyle).toContain('Do not omit, abbreviate or cut off any word');
  });

  it('uses the requested measured rate when an overlong read is retried with Edge', async () => {
    mocks.edge.mockResolvedValue({ audioUrl: 'fitted-khmer', provider: 'edge' });
    const result = await generateKhmerSpeech({ input: 'សួស្តី', targetDuration: 8, forceEdge: true, edgeRate: '+14%' });
    expect(mocks.gemini).not.toHaveBeenCalled();
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural', rate: '+14%' });
    expect(result.fallbackReason).toContain('preserved the full script');
  });

  it('falls back to a natural-speed Edge female Khmer voice', async () => {
    mocks.gemini.mockRejectedValue(new Error('provider unavailable'));
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    expect(await generateKhmerSpeech({ input: 'សួស្តី', performanceStyle: 'warm', context: 'training' })).toMatchObject({
      audioUrl: 'khmer',
      provider: 'edge',
      fallbackReason: expect.any(String),
    });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural', rate: '+6%' });
  });

  it('keeps the requested male voice when Gemini falls back to Edge', async () => {
    mocks.gemini.mockRejectedValue(new Error('provider unavailable'));
    mocks.edge.mockResolvedValue({ audioUrl: 'khmer', provider: 'edge' });
    await generateKhmerSpeech({ input: 'សួស្តី', voice: 'onyx' });
    expect(mocks.edge).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'km-KH-PisethNeural', rate: '+6%' });
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
  it('retries once when a script leaves an English loanword unspelled, pointing the retry at that exact word', async () => {
    mocks.text.mockResolvedValueOnce('សួស្តី automation។').mockResolvedValueOnce('សួស្តី អូតូម៉ាស្យូង។');
    const result = await createKhmerNarration('automation tips');
    expect(result).toBe('សួស្តី អូតូម៉ាស្យូង។');
    expect(mocks.text).toHaveBeenCalledTimes(2);
    expect(mocks.text.mock.calls[1][0].prompt).toContain('automation');
    expect(mocks.text.mock.calls[1][0].prompt).toContain('Latin letters');
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
});
