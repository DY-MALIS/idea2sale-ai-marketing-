import { expect, it } from 'vitest';
import { videoOptionsFromRecoveredStart } from '../../src/lib/videoRecoveryState';

it('restores English narration after a video start response is lost', () => {
  const saved = videoOptionsFromRecoveredStart({
    resumeNarration: { text: 'Welcome to DGACADEMY', voice: 'alloy', languageHint: 'English', performanceStyle: 'Warm' },
    silentRequested: false,
    aspectRatio: '16:9',
  }, {});
  expect(saved.resumeNarration?.text).toBe('Welcome to DGACADEMY');
  expect(saved.silentRequested).toBe(false);
  expect(saved.aspectRatio).toBe('16:9');
});

it('restores a Khmer script while preferring the exact provider transcript', () => {
  const saved = videoOptionsFromRecoveredStart({
    silentRequested: false,
    expectedScript: 'សួស្តី',
    aspectRatio: '9:16',
  }, { spokenScript: 'សួស្តីអ្នកទាំងអស់គ្នា', outputAspectRatio: '16:9' });
  expect(saved.silentRequested).toBe(false);
  expect(saved.expectedScript).toBe('សួស្តីអ្នកទាំងអស់គ្នា');
  expect(saved.aspectRatio).toBe('16:9');
});

it('keeps a video explicitly requested without sound silent on resume', () => {
  expect(videoOptionsFromRecoveredStart({ silentRequested: true }, {}).silentRequested).toBe(true);
});
