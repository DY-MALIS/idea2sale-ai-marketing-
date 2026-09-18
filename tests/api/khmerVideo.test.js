import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn(), speech: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterImage: mocks.image, startOpenRouterVideo: mocks.video }));
vi.mock('../../api/_khmerNarration.js', () => ({ generateKhmerSpeech: mocks.speech }));
import { fitKhmerClipDurationToNarration, startKhmerVideoJob } from '../../api/_khmerVideo.js';
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const uploadStub = ({ audioDuration = 3.4, audioUrl = 'https://audio', imageUrl = 'https://image' } = {}) => vi.fn(async ({ mediaType }) => (
  mediaType === 'audio'
    ? { mediaUrl: audioUrl, duration: audioDuration }
    : { mediaUrl: imageUrl }
));
it('uses the same measured audio and supplied portrait for manual video lip sync', async () => {
  mocks.speech.mockResolvedValue({ audioUrl: 'audio-data', provider: 'gemini' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/test');
  const upload = uploadStub({ imageUrl: 'https://ik.imagekit.io/test/image.png?tr=w-1280%2Cq-auto%2Cf-auto' });
  const result = await startKhmerVideoJob({ voiceGender: 'Male' }, { script: 'សួស្តី', prompt: 'Presenter', motionPrompt: 'Normal speed' }, upload, { duration: 4, images: [{ mimeType: 'image/png', base64: 'AAAA' }] });
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.speech).toHaveBeenCalledWith({
    input: 'សួស្តី',
    voice: 'Male',
    performanceStyle: '',
    context: 'Presenter',
    targetDuration: 4,
  });
  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ model: 'bytedance/seedance-2.0-mini', khmerSpeech: true, duration: 4, aspectRatio: '9:16', referenceUrls: ['https://ik.imagekit.io/test/image.png'], audioReferenceUrls: ['https://audio'], prompt: expect.stringContaining('3.40 seconds') }));
  expect(mocks.video.mock.calls[0][0].prompt).toContain('AUDIO MASTER CLOCK');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('KHMER PHONEME TRANSCRIPT');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('"សួស្តី"');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('Never infer, invent, speak, or visibly articulate any English word');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('Do not use generic talking-mouth animation');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('Speech, lips, jaw, tongue and cheeks remain synchronized frame by frame at natural 1x');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('fast-natural 1.1x energy');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('Complete each gesture in 0.35 to 0.55 seconds');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('synchronized frame by frame');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('Never freeze, stretch, ease or slow any movement');
  expect(result.narrationAudio.mediaUrl).toBe('https://audio');
  expect(result.narrationAudio.provider).toBe('gemini');
});
it('can keep the Seedance result silent for client-side narration muxing', async () => {
  mocks.speech.mockResolvedValue({ audioUrl: 'audio-data', duration: 3.4, provider: 'gemini' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub();

  await startKhmerVideoJob(
    { voiceGender: 'Female' },
    { script: 'សួស្តី', prompt: 'Presenter', motionPrompt: 'Normal speed' },
    upload,
    { duration: 4, images: [{ mimeType: 'image/png', base64: 'AAAA' }], generateAudio: false },
  );

  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({
    audioReferenceUrls: ['https://audio'],
    generateAudio: false,
  }));
});
it('expands a short requested clip instead of rejecting an appropriate script', async () => {
  mocks.image.mockResolvedValue({ imageUrl: 'portrait' });
  mocks.speech.mockResolvedValue({ audioUrl: 'audio' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub({ audioDuration: 4.5, imageUrl: 'image' });
  const result = await startKhmerVideoJob({}, { script: 'សួស្តី' }, upload, { duration: 4 });
  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ duration: 5 }));
  expect(result.job.outputDuration).toBe(5);
});

it('still rejects narration that exceeds the eight-second budget ceiling', async () => {
  mocks.image.mockResolvedValue({ imageUrl: 'portrait' });
  mocks.speech.mockResolvedValue({ audioUrl: 'audio' });
  const upload = uploadStub({ audioDuration: 8.1, imageUrl: 'image' });
  await expect(startKhmerVideoJob({}, { script: 'សួស្តី' }, upload, { duration: 8 })).rejects.toThrow('maximum 8-second clip');
  expect(mocks.speech).toHaveBeenCalledTimes(2);
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.video).not.toHaveBeenCalled();
});

it('retries an overlong expressive read at a measured Edge rate without changing the script', async () => {
  mocks.speech
    .mockResolvedValueOnce({ audioUrl: 'expressive-audio', duration: 8.4, provider: 'gemini' })
    .mockResolvedValueOnce({ audioUrl: 'fitted-audio', model: 'edge-km-KH-SreymomNeural', fallbackReason: 'fitted' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub({ audioDuration: 7.7 });

  const result = await startKhmerVideoJob(
    { voiceGender: 'Female' },
    { script: 'សួស្តី', prompt: 'Presenter', motionPrompt: 'Natural movement' },
    upload,
    { duration: 8, images: [{ mimeType: 'image/png', base64: 'AAAA' }] },
  );

  expect(mocks.speech).toHaveBeenNthCalledWith(2, expect.objectContaining({
    input: 'សួស្តី',
    forceEdge: true,
    edgeRate: '+14%',
  }));
  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ duration: 8, audioReferenceUrls: ['https://audio'] }));
  expect(result.narrationAudio.duration).toBe(7.7);
});

it('fits the generated clip to the measured narration instead of stretching motion', async () => {
  expect(fitKhmerClipDurationToNarration(2.5, 8)).toBe(4);
  expect(fitKhmerClipDurationToNarration(4.8, 8)).toBe(5);
  expect(fitKhmerClipDurationToNarration(6.8, 8)).toBe(7);

  mocks.speech.mockResolvedValue({ audioUrl: 'audio-data', duration: 2.5, provider: 'gemini' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub();

  const result = await startKhmerVideoJob(
    { voiceGender: 'Female' },
    { script: 'សួស្តី', prompt: 'Presenter', motionPrompt: 'Natural movement' },
    upload,
    { duration: 8, images: [{ mimeType: 'image/png', base64: 'AAAA' }] },
  );

  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ duration: 4 }));
  expect(mocks.video.mock.calls[0][0].prompt).toContain('4-second clip');
  expect(result.job.outputDuration).toBe(4);
});

it('rejects an over-budget duration before any paid preparation starts', async () => {
  const upload = vi.fn();
  await expect(startKhmerVideoJob({}, { script: 'សួស្តី' }, upload, { duration: 16 })).rejects.toThrow('$0.80');
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.speech).not.toHaveBeenCalled();
  expect(mocks.video).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
