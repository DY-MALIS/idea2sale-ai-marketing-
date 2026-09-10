import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn(), speech: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterImage: mocks.image, startOpenRouterVideo: mocks.video }));
vi.mock('../../api/_khmerNarration.js', () => ({ generateKhmerSpeech: mocks.speech }));
import { startKhmerVideoJob } from '../../api/_khmerVideo.js';
afterEach(() => vi.resetAllMocks());
it('uses the same measured audio and supplied portrait for manual video lip sync', async () => {
  mocks.speech.mockResolvedValue({ audioUrl: 'audio-data' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = vi.fn().mockResolvedValueOnce({ mediaUrl: 'https://image' }).mockResolvedValueOnce({ mediaUrl: 'https://audio', duration: 3.4 });
  const result = await startKhmerVideoJob({ voiceGender: 'Male' }, { script: 'សួស្តី', prompt: 'Presenter', motionPrompt: 'Normal speed' }, upload, { duration: 4, images: [{ mimeType: 'image/png', base64: 'AAAA' }] });
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.speech).toHaveBeenCalledWith({ input: 'សួស្តី', voice: 'Male' });
  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ model: 'bytedance/seedance-2.0-mini', duration: 4, referenceUrls: ['https://image'], audioReferenceUrls: ['https://audio'], prompt: expect.stringContaining('3.40 seconds') }));
  expect(result.narrationAudio.mediaUrl).toBe('https://audio');
});
it('does not start a video when speech would be cut off', async () => {
  mocks.image.mockResolvedValue({ imageUrl: 'portrait' });
  mocks.speech.mockResolvedValue({ audioUrl: 'audio' });
  const upload = vi.fn().mockResolvedValueOnce({ mediaUrl: 'image' }).mockResolvedValueOnce({ duration: 4.5 });
  await expect(startKhmerVideoJob({}, { script: 'សួស្តី' }, upload, { duration: 4 })).rejects.toThrow('fit within');
  expect(mocks.video).not.toHaveBeenCalled();
});
