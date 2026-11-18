import { describe, expect, it } from 'vitest';
import {
  foodPreparationGuidance,
  isFoodCreativeRequest,
  shouldDefaultToFoodPreparation,
  wantsNonRecipeFoodCreative,
} from '../../shared/foodCreativeGuidance.js';

describe('food creative guidance', () => {
  it('recognizes broad English and Khmer food subjects', () => {
    expect(isFoodCreativeRequest('Create a video about food')).toBe(true);
    expect(isFoodCreativeRequest('បង្កើតវីដេអូអំពីម្ហូបខ្មែរ')).toBe(true);
    expect(isFoodCreativeRequest('របៀបធ្វើអាម៉ុកត្រី')).toBe(true);
    expect(isFoodCreativeRequest('Create a video about digital marketing')).toBe(false);
  });

  it('defaults ordinary food requests to a cooking process', () => {
    expect(shouldDefaultToFoodPreparation('Create a video about Cambodian food')).toBe(true);
    expect(shouldDefaultToFoodPreparation('បង្កើតវីដេអូអំពីម្ហូបខ្មែរ')).toBe(true);
    expect(foodPreparationGuidance('food', 'video')).toContain('practical cooking how-to');
    expect(foodPreparationGuidance('ម្ហូប', 'image')).toContain('preparation in progress');
  });

  it('respects an explicit restaurant, advertisement, review, or eating intent', () => {
    for (const prompt of [
      'Create a restaurant promotional video about our food',
      'Make a food menu advertisement',
      'ថតរីវីយូម្ហូបនៅភោជនីយដ្ឋាន',
      'បង្កើតវីដេអូផ្សព្វផ្សាយម្ហូប',
    ]) {
      expect(wantsNonRecipeFoodCreative(prompt)).toBe(true);
      expect(shouldDefaultToFoodPreparation(prompt)).toBe(false);
      expect(foodPreparationGuidance(prompt)).toBe('');
    }
  });
});
