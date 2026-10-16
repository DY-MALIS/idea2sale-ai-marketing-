import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), gemini: vi.fn(), edge: vi.fn() }));
vi.mock('../../api/_openrouter.js', async (importOriginal) => ({
  ...await importOriginal(),
  transcribeAudioWithOpenRouter: mocks.transcribe,
}));
vi.mock('../../api/_geminiSpeech.js', () => ({ generateGeminiSpeech: mocks.gemini }));
vi.mock('../../api/_edgeSpeech.js', () => ({ synthesizeKhmerSpeechViaEdge: mocks.edge }));

import { generateKhmerSpeech, isUnreliableKhmerTranscript } from '../../api/_khmerNarration.js';

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it('identifies numeric STT hallucinations without excusing coherent English speech', () => {
  expect(isUnreliableKhmerTranscript('song 2 100 400 200 200 100 200')).toBe(true);
  expect(isUnreliableKhmerTranscript('I will share 2 great ways to save 100 dollars today')).toBe(false);
  expect(isUnreliableKhmerTranscript('សួស្តី 100 200 300')).toBe(false);
});

it('uses the Khmer neural voice when STT returns numeric hallucinations instead of repeating Gemini', async () => {
  mocks.gemini.mockResolvedValue({ audioUrl: 'data:audio/wav;base64,AAAA', provider: 'gemini' });
  mocks.transcribe.mockResolvedValue('song 2 100 400 200 200 100 200');
  mocks.edge.mockResolvedValue({ audioUrl: 'data:audio/mpeg;base64,BBBB', provider: 'edge' });

  const audio = await generateKhmerSpeech({ input: 'សួស្តីអ្នកទាំងអស់គ្នា', targetDuration: 8 });

  expect(mocks.gemini).toHaveBeenCalledTimes(1);
  expect(mocks.edge).toHaveBeenCalledTimes(1);
  expect(audio.provider).toBe('edge');
  expect(audio.spokenText).toBe('សួស្តីអ្នកទាំងអស់គ្នា');
});

it('rejects a coherent English transcript from Gemini before selecting the Khmer neural voice', async () => {
  mocks.gemini.mockResolvedValue({ audioUrl: 'data:audio/wav;base64,AAAA', provider: 'gemini' });
  mocks.transcribe.mockResolvedValue('Hello everyone, welcome to the festival today.');
  mocks.edge.mockResolvedValue({ audioUrl: 'data:audio/mpeg;base64,BBBB', provider: 'edge' });

  const audio = await generateKhmerSpeech({ input: 'សួស្តីអ្នកទាំងអស់គ្នា', targetDuration: 8 });

  expect(mocks.gemini).toHaveBeenCalledTimes(2);
  expect(mocks.edge).toHaveBeenCalledTimes(1);
  expect(audio.provider).toBe('edge');
});
