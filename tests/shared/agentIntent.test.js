import { expect, it } from 'vitest';
import { isContentPlanCreationRequest, isStandaloneAudioRequest, shouldClassifyCreativeMedia } from '../../shared/agentIntent.js';

it('routes direct content plan requests while leaving advice questions in chat', () => {
  expect(isContentPlanCreationRequest('សូមបង្កើត content plan 7 ថ្ងៃសម្រាប់ហាងកាហ្វេ')).toBe(true);
  expect(isContentPlanCreationRequest('Can you create a content plan for next week?')).toBe(true);
  expect(isContentPlanCreationRequest('Create a content planner')).toBe(true);
  expect(isContentPlanCreationRequest('How do I create a content plan?')).toBe(false);
});

it('routes spoken audio separately from video generation', () => {
  expect(isStandaloneAudioRequest('បង្កើតសំឡេងនិយាយផ្សព្វផ្សាយហាងកាហ្វេ')).toBe(true);
  expect(isStandaloneAudioRequest('Generate a voiceover for our product')).toBe(true);
  expect(isStandaloneAudioRequest('Generate a voiceover for my video')).toBe(true);
  expect(isStandaloneAudioRequest('Create a video with voiceover')).toBe(false);
});

it('does not run the media classifier for ordinary follow-ups after a past video', () => {
  const history = 'User: Create a video of coffee\nAssistant: Do you want Khmer narration?';
  expect(shouldClassifyCreativeMedia('How can I sell more coffee?', history)).toBe(false);
  expect(shouldClassifyCreativeMedia('What is video marketing?', history)).toBe(false);
  expect(shouldClassifyCreativeMedia('Create a video of pouring coffee', '')).toBe(true);
  expect(shouldClassifyCreativeMedia('Go ahead', history)).toBe(true);
  expect(shouldClassifyCreativeMedia('With Khmer narration', history)).toBe(true);
  expect(shouldClassifyCreativeMedia('Go ahead', 'User: Create a video of coffee\nAssistant: The video is starting.\nUser: Thanks\nAssistant: You are welcome.')).toBe(false);
});
