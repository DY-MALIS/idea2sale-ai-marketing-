import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ image: vi.fn(), video: vi.fn(), speech: vi.fn(), shorten: vi.fn(), expand: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterImage: mocks.image, startOpenRouterVideo: mocks.video }));
vi.mock('../../api/_khmerNarration.js', () => ({ generateKhmerSpeech: mocks.speech, shortenGeneratedKhmerNarration: mocks.shorten, expandGeneratedKhmerNarration: mocks.expand }));
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
  expect(mocks.video.mock.calls[0][0].prompt).toContain('ZERO-LATENCY LIP SYNC');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('Do not let the lips lag, trail, drift behind, catch up to, or echo the audio');
  expect(result.narrationAudio.mediaUrl).toBe('https://audio');
  expect(result.narrationAudio.provider).toBe('gemini');
});
it('can render the narration and lip motion together when provider audio is requested', async () => {
  mocks.speech.mockResolvedValue({ audioUrl: 'audio-data', duration: 3.4, provider: 'gemini' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub();

  await startKhmerVideoJob(
    { voiceGender: 'Female' },
    { script: 'សួស្តី', prompt: 'Presenter', motionPrompt: 'Normal speed' },
    upload,
    { duration: 4, images: [{ mimeType: 'image/png', base64: 'AAAA' }], generateAudio: true },
  );

  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({
    audioReferenceUrls: ['https://audio'],
    generateAudio: true,
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

it('handles an avatar failure that occurs while narration is still running', async () => {
  let finishSpeech;
  mocks.image.mockRejectedValue(new Error('Avatar image unavailable'));
  mocks.speech.mockImplementation(() => new Promise((resolve) => { finishSpeech = resolve; }));
  const upload = uploadStub();
  const started = startKhmerVideoJob({}, { script: 'សួស្តី', prompt: 'Presenter' }, upload, { duration: 4 });
  await Promise.resolve();
  finishSpeech({ audioUrl: 'audio-data', duration: 3.4 });

  await expect(started).rejects.toThrow('Avatar image unavailable');
  expect(mocks.video).not.toHaveBeenCalled();
});

it('still rejects narration that exceeds the eight-second budget ceiling', async () => {
  mocks.image.mockResolvedValue({ imageUrl: 'portrait' });
  mocks.speech.mockResolvedValue({ audioUrl: 'audio' });
  const upload = uploadStub({ audioDuration: 8.1, imageUrl: 'image' });
  await expect(startKhmerVideoJob({}, { script: 'សួស្តី' }, upload, { duration: 8 })).rejects.toThrow('maximum 8-second clip');
  expect(mocks.speech).toHaveBeenCalledTimes(2);
  // The avatar image now starts in parallel with narration (it has no
  // dependency on narration audio), so it's fired before narration is known
  // to have failed -- an accepted, rare, budget-model-cost tradeoff for a
  // universal latency win on every successful generation. The video call
  // (the expensive one) stays correctly gated behind narration succeeding.
  expect(mocks.image).toHaveBeenCalledTimes(1);
  expect(mocks.video).not.toHaveBeenCalled();
});

it('shortens an overlong AI scanner script before starting a paid video', async () => {
  mocks.speech
    .mockResolvedValueOnce({ audioUrl: 'long-audio', duration: 9.2, provider: 'gemini' })
    .mockResolvedValueOnce({ audioUrl: 'short-audio', duration: 6.5, provider: 'gemini', spokenText: 'ខ្លី និង ច្បាស់' });
  mocks.shorten.mockResolvedValue('ខ្លី និង ច្បាស់');
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub({ audioDuration: 6.5 });
  const result = await startKhmerVideoJob(
    { businessName: 'Example Cafe' },
    { script: 'ប្រយោគខ្មែរដែលវែងខ្លាំង', prompt: 'Presenter' },
    upload,
    { duration: 8, images: [{ mimeType: 'image/png', base64: 'AAAA' }], allowScriptShortening: true },
  );
  expect(mocks.shorten).toHaveBeenCalledWith('ប្រយោគខ្មែរដែលវែងខ្លាំង', 'Example Cafe', 45);
  expect(mocks.speech).toHaveBeenCalledTimes(2);
  expect(mocks.video).toHaveBeenCalledTimes(1);
  expect(result.narrationAudio.spokenText).toBe('ខ្លី និង ច្បាស់');
});

it('rewrites a Latin brand in AI scanner speech before synthesis', async () => {
  mocks.shorten.mockResolvedValue('ហាងកាហ្វេរបស់យើង');
  mocks.speech.mockResolvedValue({ audioUrl: 'audio', duration: 4.2, provider: 'edge' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = uploadStub({ audioDuration: 4.2 });
  await startKhmerVideoJob(
    { businessName: 'Dating Cafe & Mart' },
    { script: 'សូមមក Dating Cafe & Mart', prompt: 'Cafe' },
    upload,
    { duration: 8, images: [{ mimeType: 'image/png', base64: 'AAAA' }], allowScriptShortening: true },
  );
  expect(mocks.speech).toHaveBeenCalledWith(expect.objectContaining({ input: 'ហាងកាហ្វេរបស់យើង' }));
  expect(mocks.shorten).toHaveBeenCalledWith(expect.any(String), 'Dating Cafe & Mart', 85);
});

it('expands a short AI content-plan narration before paying for an eight-second video', async () => {
  const original = 'សួស្តី';
  const expanded = 'សួស្តី មកមើលវិធីប្រើផលិតផលនេះឱ្យងាយស្រួលជាងមុន។';
  mocks.expand.mockResolvedValue(expanded);
  mocks.speech
    .mockResolvedValueOnce({ audioUrl: 'short-audio', duration: 3.2, provider: 'edge' })
    .mockResolvedValueOnce({ audioUrl: 'full-audio', duration: 7.1, provider: 'edge', spokenText: expanded });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = vi.fn(async ({ mediaDataUrl, mediaType }) => ({ mediaUrl: mediaType === 'audio' ? `https://${mediaDataUrl}` : 'https://image' }));

  const result = await startKhmerVideoJob(
    { businessName: 'Example Shop' },
    { script: original, prompt: 'Product demonstration' },
    upload,
    { duration: 8, images: [{ mimeType: 'image/png', base64: 'AAAA' }], allowScriptShortening: true },
  );

  expect(mocks.expand).toHaveBeenCalledWith(original, 'Example Shop', 3.2);
  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ duration: 8, audioReferenceUrls: ['https://full-audio'] }));
  expect(result.narrationAudio).toMatchObject({ duration: 7.1, spokenText: expanded, mediaUrl: 'https://full-audio' });
});

it('keeps the original content-plan narration when the expanded read exceeds eight seconds', async () => {
  mocks.expand.mockResolvedValue('វីដេអូនេះបង្ហាញផលិតផល និងព័ត៌មានលម្អិតបន្ថែមសម្រាប់អតិថិជន។');
  mocks.speech
    .mockResolvedValueOnce({ audioUrl: 'short-audio', duration: 3.2, provider: 'edge' })
    .mockResolvedValueOnce({ audioUrl: 'overlong-audio', duration: 8.7, provider: 'edge' });
  mocks.video.mockResolvedValue({ jobId: 'job' });
  const upload = vi.fn(async ({ mediaDataUrl, mediaType }) => ({ mediaUrl: mediaType === 'audio' ? `https://${mediaDataUrl}` : 'https://image' }));

  const result = await startKhmerVideoJob(
    {}, { script: 'សួស្តី', prompt: 'Product' }, upload,
    { duration: 8, images: [{ mimeType: 'image/png', base64: 'AAAA' }], allowScriptShortening: true },
  );

  expect(mocks.video).toHaveBeenCalledWith(expect.objectContaining({ duration: 4, audioReferenceUrls: ['https://short-audio'] }));
  expect(result.narrationAudio.duration).toBe(3.2);
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

it('bounds the speaking shot to narration and expands only when narration requires it', async () => {
  expect(fitKhmerClipDurationToNarration(2.5, 8)).toBe(4);
  expect(fitKhmerClipDurationToNarration(4.8, 8)).toBe(5);
  expect(fitKhmerClipDurationToNarration(6.8, 8)).toBe(7);
  expect(fitKhmerClipDurationToNarration(5.928, 8)).toBe(6);
  expect(fitKhmerClipDurationToNarration(4.8, 4)).toBe(5);
  expect(fitKhmerClipDurationToNarration(6.8, 6)).toBe(7);

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
  expect(mocks.video.mock.calls[0][0].prompt).toContain('HARD MOUTH STOP: by 2.50 seconds');
  expect(mocks.video.mock.calls[0][0].prompt).toContain('until the full clip ends');
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
