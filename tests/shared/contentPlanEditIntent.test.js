import { describe, expect, it } from 'vitest';
import { isContentPlanEditRequest } from '../../shared/contentPlanEditIntent.js';

describe('isContentPlanEditRequest', () => {
  it('routes direct Khmer and English plan edits to the plan card', () => {
    expect(isContentPlanEditRequest('សូមកែ content plan ថ្ងៃទី ៣ ឱ្យទៅជាវីដេអូ')).toBe(true);
    expect(isContentPlanEditRequest('Change day 3 in the content plan to a video')).toBe(true);
  });

  it('keeps plan creation and questions in the normal agent flow', () => {
    expect(isContentPlanEditRequest('បង្កើត content plan មួយខែ')).toBe(false);
    expect(isContentPlanEditRequest('What is a content plan?')).toBe(false);
  });
});
