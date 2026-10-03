import { describe, expect, it } from 'vitest';
import { isContentPlanEditFollowup, isContentPlanEditPronounFollowup, isContentPlanEditRequest } from '../../shared/contentPlanEditIntent.js';

describe('isContentPlanEditRequest', () => {
  it('routes direct Khmer and English plan edits to the plan card', () => {
    expect(isContentPlanEditRequest('សូមកែ content plan ថ្ងៃទី ៣ ឱ្យទៅជាវីដេអូ')).toBe(true);
    expect(isContentPlanEditRequest('Change day 3 in the content plan to a video')).toBe(true);
    expect(isContentPlanEditRequest('បន្ថែមវីដេអូមួយនៅក្នុងផែនការ')).toBe(true);
    expect(isContentPlanEditRequest('Remove day 5 from the plan')).toBe(true);
    expect(isContentPlanEditRequest('Make day 3 a video')).toBe(true);
  });

  it('keeps plan creation and questions in the normal agent flow', () => {
    expect(isContentPlanEditRequest('បង្កើត content plan មួយខែ')).toBe(false);
    expect(isContentPlanEditRequest('បង្កើត plan សម្រាប់ ៣០ ថ្ងៃ')).toBe(false);
    expect(isContentPlanEditRequest('What is a content plan?')).toBe(false);
  });

  it('recognizes a short follow-up after a plan edit', () => {
    expect(isContentPlanEditRequest('Change it to a video')).toBe(false);
    expect(isContentPlanEditFollowup('Change it to a video')).toBe(true);
    expect(isContentPlanEditFollowup('ប្តូរវាទៅវីដេអូ')).toBe(true);
  });
});

describe('isContentPlanEditPronounFollowup', () => {
  it('recognizes a pronoun-based edit even as the very first message, before any assistant turn mentioned the plan', () => {
    expect(isContentPlanEditPronounFollowup('Change it to a video')).toBe(true);
    expect(isContentPlanEditPronounFollowup('ប្តូរវាទៅជាវីដេអូ')).toBe(true);
    expect(isContentPlanEditPronounFollowup('Make this a video')).toBe(true);
  });

  it('does not misfire on an unrelated message that happens to share an edit verb', () => {
    expect(isContentPlanEditPronounFollowup('Update me on the weather')).toBe(false);
    expect(isContentPlanEditPronounFollowup('What is a content plan?')).toBe(false);
  });
});
