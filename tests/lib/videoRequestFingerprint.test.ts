import { expect, it } from 'vitest';
import { videoRequestFingerprint } from '../../src/lib/videoRequestFingerprint';

const prompt = 'A short training video';
const images = [{ mimeType: 'image/png', base64: 'a'.repeat(50) + 'middle' + 'z'.repeat(50) }];
const speech = {
  script: 'សួស្តី',
  voiceGender: 'Female',
  businessName: 'Training company',
  performanceStyle: 'Warm',
  allowScriptShortening: false,
};

it('recovers the same video only when the provider and narration inputs match', () => {
  const original = videoRequestFingerprint(prompt, images, 4, '16:9', speech, { silentRequested: false });
  expect(videoRequestFingerprint(prompt, images, 4, '16:9', { ...speech }, { silentRequested: false })).toBe(original);
  expect(videoRequestFingerprint(prompt, images, 4, '16:9', { ...speech, voiceGender: 'Male' }, { silentRequested: false })).not.toBe(original);
  expect(videoRequestFingerprint(prompt, images, 4, '16:9', { ...speech, performanceStyle: 'Calm' }, { silentRequested: false })).not.toBe(original);
  expect(videoRequestFingerprint(prompt, images, 4, '16:9', { ...speech, allowScriptShortening: true }, { silentRequested: false })).not.toBe(original);
  expect(videoRequestFingerprint(prompt, images, 4, '16:9', speech, { silentRequested: true })).not.toBe(original);
  expect(videoRequestFingerprint(prompt, [{ ...images[0], base64: 'a'.repeat(50) + 'other!' + 'z'.repeat(50) }], 4, '16:9', speech, { silentRequested: false })).not.toBe(original);
});

it('keeps separate recovered videos for different English narration', () => {
  const options = { resumeNarration: { text: 'Welcome', voice: 'nova', languageHint: 'English' as const, performanceStyle: 'Warm' } };
  const original = videoRequestFingerprint(prompt, [], 4, '16:9', undefined, options);
  expect(videoRequestFingerprint(prompt, [], 4, '16:9', undefined, { resumeNarration: { ...options.resumeNarration, text: 'Goodbye' } })).not.toBe(original);
  expect(videoRequestFingerprint(prompt, [], 4, '16:9', undefined, { resumeNarration: { ...options.resumeNarration, voice: 'onyx' } })).not.toBe(original);
});
