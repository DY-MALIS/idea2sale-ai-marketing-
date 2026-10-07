import { describe, expect, it } from 'vitest';
import {
  assertVideoGenerationWithinBudget,
  estimateVideoGenerationCostUsd,
  KHMER_VIDEO_MODEL,
  MAX_VIDEO_GENERATION_COST_USD,
  STANDARD_VIDEO_MODEL,
} from '../../shared/videoCost.js';

describe('video cost ceiling', () => {
  it('uses the 720p video-only rates for every supported duration', () => {
    for (const [duration, standard, alternate, khmer] of [
      [4, 0.17, 0.3524, 0.4524], [6, 0.23, 0.5036, 0.6036], [8, 0.29, 0.6548, 0.7548],
    ]) {
      expect(estimateVideoGenerationCostUsd({ duration, model: STANDARD_VIDEO_MODEL })).toBe(standard);
      expect(estimateVideoGenerationCostUsd({ duration, model: KHMER_VIDEO_MODEL })).toBe(alternate);
      expect(estimateVideoGenerationCostUsd({ duration, khmerSpeech: true, model: KHMER_VIDEO_MODEL })).toBe(khmer);
      expect(khmer).toBeLessThanOrEqual(MAX_VIDEO_GENERATION_COST_USD);
    }
  });

  it('rejects longer or unknown-model generations before submission', () => {
    expect(() => assertVideoGenerationWithinBudget({ duration: 16, model: STANDARD_VIDEO_MODEL })).toThrow('$0.80');
    expect(() => assertVideoGenerationWithinBudget({ duration: 8, model: 'google/veo-3.1' })).toThrow('$0.80');
  });
});
