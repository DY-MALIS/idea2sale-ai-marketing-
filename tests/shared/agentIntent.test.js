import { expect, it } from 'vitest';
import { isContentPlanCreationRequest, isStandaloneAudioRequest, isTextContentCreationRequest, isVideoCreationFromPlanRequest, shouldClassifyCreativeMedia } from '../../shared/agentIntent.js';

it('routes spoken text content creation to a visible agent response', () => {
  expect(isTextContentCreationRequest('បង្កើត content សម្រាប់ហាងកាហ្វេ')).toBe(true);
  expect(isTextContentCreationRequest('Write a Facebook caption for my shop')).toBe(true);
  expect(isTextContentCreationRequest('Create a content plan for next week')).toBe(false);
  expect(isTextContentCreationRequest('Create a video of coffee')).toBe(false);
  expect(isTextContentCreationRequest('How do I create content?')).toBe(false);
});

it('routes direct content plan requests while leaving advice questions in chat', () => {
  expect(isContentPlanCreationRequest('សូមបង្កើត content plan 7 ថ្ងៃសម្រាប់ហាងកាហ្វេ')).toBe(true);
  expect(isContentPlanCreationRequest('Can you create a content plan for next week?')).toBe(true);
  expect(isContentPlanCreationRequest('Create a content planner')).toBe(true);
  expect(isContentPlanCreationRequest('How do I create a content plan?')).toBe(false);
});

it('routes a video made from a content plan to video generation, not plan creation', () => {
  for (const command of [
    'Create a video from my content plan',
    'Generate a video from the Excel content plan for Telegram',
    'From my content plan, create a video for today',
    'សូមបង្កើតវីដេអូតាម content plan',
  ]) {
    expect(isVideoCreationFromPlanRequest(command)).toBe(true);
    expect(isContentPlanCreationRequest(command)).toBe(false);
    expect(shouldClassifyCreativeMedia(command)).toBe(true);
  }
  expect(isVideoCreationFromPlanRequest('Create a content plan for videos')).toBe(false);
  expect(isContentPlanCreationRequest('Create a content plan for videos')).toBe(true);
});

it('routes spoken audio separately from video generation', () => {
  expect(isStandaloneAudioRequest('បង្កើតសំឡេងនិយាយផ្សព្វផ្សាយហាងកាហ្វេ')).toBe(true);
  expect(isStandaloneAudioRequest('Generate a voiceover for our product')).toBe(true);
  expect(isStandaloneAudioRequest('Generate a voiceover for my video')).toBe(true);
  expect(isStandaloneAudioRequest('Create a video with voiceover')).toBe(false);
});

it('recognizes spoken poster/picture requests in the spellings Khmer speech-to-text produces', () => {
  for (const command of [
    'បង្កើតប៉ូស្ទ័រមួយសម្រាប់ហាងកាហ្វេ',
    'បង្កើតផូស្ទ័រមួយ',
    'ខ្ញុំចង់បានប៉ុស្ទ័រលក់នំ',
    'ជួយធ្វើពូសទ័រផ្សព្វផ្សាយ',
    'បង្កើតរូប មួយសម្រាប់ផលិតផល',
    'make me a poster for my shop',
    'Draw a picture of iced coffee',
  ]) {
    expect(shouldClassifyCreativeMedia(command)).toBe(true);
  }
  expect(shouldClassifyCreativeMedia('តើប៉ូស្ទ័របែបណាល្អ?')).toBe(false);
  // "post to Facebook" must not be read as a poster.
  expect(shouldClassifyCreativeMedia('ជួយផុសទៅ Facebook')).toBe(false);
  expect(shouldClassifyCreativeMedia('បង្កើតវិដេអូមួយអំពីកាហ្វេ')).toBe(true);
});

it('recognizes spoken content-plan and caption commands in Khmer transliterations', () => {
  expect(isContentPlanCreationRequest('បង្កើតខនថេនផ្លែន ៧ ថ្ងៃ')).toBe(true);
  expect(isContentPlanCreationRequest('សូមរៀបចំផែនការប៉ុស្ត៍សម្រាប់ហាង')).toBe(true);
  expect(isContentPlanCreationRequest('បង្កើតផែនការ 7 ថ្ងៃ សម្រាប់ Facebook')).toBe(true);
  expect(isContentPlanCreationRequest('Create a 7 day posting plan')).toBe(true);
  expect(isTextContentCreationRequest('សរសេរខេបសិនសម្រាប់ហាងកាហ្វេ')).toBe(true);
  expect(isTextContentCreationRequest('បង្កើតប៉ុស្ត៍មួយសម្រាប់ Facebook')).toBe(true);
});

it('does not run the media classifier for ordinary follow-ups after a past video', () => {
  const history = 'User: Create a video of coffee\nAssistant: Do you want Khmer narration?';
  expect(shouldClassifyCreativeMedia('How can I sell more coffee?', history)).toBe(false);
  expect(shouldClassifyCreativeMedia('What is video marketing?', history)).toBe(false);
  expect(shouldClassifyCreativeMedia('Create a video of pouring coffee', '')).toBe(true);
  expect(shouldClassifyCreativeMedia('How do I create a video?', '')).toBe(false);
  expect(shouldClassifyCreativeMedia('Go ahead', history)).toBe(true);
  expect(shouldClassifyCreativeMedia('With Khmer narration', history)).toBe(true);
  expect(shouldClassifyCreativeMedia('Go ahead', 'User: Create a video of coffee\nAssistant: The video is starting.\nUser: Thanks\nAssistant: You are welcome.')).toBe(false);
});
