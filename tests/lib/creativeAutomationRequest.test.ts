import { expect, it } from 'vitest';
import { buildCreativeAutomationRequest } from '../../src/lib/creativeAutomationRequest';

const readyVideo = {
  ready: true,
  kind: 'video',
  prompt: 'A barista pours fresh coffee for a customer in a bright cafe.',
  voiceOverWanted: false,
  voiceOverText: '',
};

it('keeps YouTube and landscape format when Agent hands a video to the creator', () => {
  const request = buildCreativeAutomationRequest({ ...readyVideo, platform: 'YouTube' }, 'km', 'request-1');
  expect(request).toMatchObject({ kind: 'video', platform: 'YouTube', aspectRatio: '16:9', duration: 8, voiceOverWanted: false });
});

it('preserves spoken Khmer narration and supported video duration', () => {
  const request = buildCreativeAutomationRequest({
    ...readyVideo,
    platform: 'TikTok', aspectRatio: '9:16', duration: 6,
    voiceOverWanted: true, voiceOverText: 'សាកកាហ្វេស្រស់នៅហាងយើង។',
  }, 'km', 'request-2');
  expect(request).toMatchObject({ platform: 'TikTok', aspectRatio: '9:16', duration: 6, voiceOverWanted: true, voiceOverText: 'សាកកាហ្វេស្រស់នៅហាងយើង។' });
});

it.each([
  { ...readyVideo, prompt: '' },
  { ...readyVideo, ready: false },
  { ...readyVideo, voiceOverWanted: null },
  { ...readyVideo, voiceOverWanted: true, voiceOverText: '' },
])('stops an incomplete video brief before the generator can start', (brief) => {
  expect(() => buildCreativeAutomationRequest(brief, 'en', 'request-3')).toThrow();
});
