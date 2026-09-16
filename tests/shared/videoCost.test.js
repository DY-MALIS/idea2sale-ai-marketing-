import { describe, expect, it } from 'vitest';
import {
  assertVideoGenerationWithinBudget,
  estimateVideoGenerationCostUsd,
  KHMER_VIDEO_MODEL,
  MAX_VIDEO_GENERATION_COST_USD,
  STANDARD_VIDEO_MODEL,
} from '../../shared/videoCost.js';

describe('video cost ceiling', () => {
  it('keeps standard and Khmer 8-second videos below $0.80', () => {
    expect(estimateVideoGenerationCostUsd({ duration: 8, model: STANDARD_VIDEO_MODEL })).toBeLessThanOrEqual(MAX_VIDEO_GENERATION_COST_USD);
    expect(estimateVideoGenerationCostUsd({ duration: 8, khmerSpeech: true, model: KHMER_VIDEO_MODEL })).toBeLessThanOrEqual(MAX_VIDEO_GENERATION_COST_USD);
  });

  it('rejects longer or unknown-model generations before submission', () => {
    expect(() => assertVideoGenerationWithinBudget({ duration: 16, model: STANDARD_VIDEO_MODEL })).toThrow('$0.80');
    expect(() => assertVideoGenerationWithinBudget({ duration: 8, model: 'google/veo-3.1' })).toThrow('$0.80');
  });
});
