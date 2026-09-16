export const MAX_VIDEO_GENERATION_COST_USD = 0.80;
export const MAX_VIDEO_DURATION_SECONDS = 8;

export const STANDARD_VIDEO_MODEL = 'google/veo-3.1-lite';
export const KHMER_VIDEO_MODEL = 'bytedance/seedance-2.0-mini';
export const BUDGET_AVATAR_IMAGE_MODEL = 'bytedance-seed/seedream-5-0-pro';
export const VIDEO_RESOLUTION = '720p';

// Current OpenRouter 720p list prices. The estimates intentionally include a
// reserve for prompt normalization and, for Khmer presenter videos, avatar
// image + narration generation. This keeps the entire user action under the
// $0.80 ceiling rather than budgeting only for the final /videos request.
const VIDEO_COST_PER_SECOND_USD = Object.freeze({
  [STANDARD_VIDEO_MODEL]: 0.05,
  [KHMER_VIDEO_MODEL]: 0.0756,
});

const STANDARD_AUXILIARY_RESERVE_USD = 0.05;
const KHMER_AUXILIARY_RESERVE_USD = 0.15;

/** @param {string} model */
export const isBudgetVideoModel = (model) => Object.hasOwn(VIDEO_COST_PER_SECOND_USD, model);

/**
 * @param {{ duration: number, khmerSpeech?: boolean, model?: string }} options
 */
export const estimateVideoGenerationCostUsd = ({ duration, khmerSpeech = false, model } = {}) => {
  const selectedModel = model || (khmerSpeech ? KHMER_VIDEO_MODEL : STANDARD_VIDEO_MODEL);
  const seconds = Number(duration);
  const perSecond = VIDEO_COST_PER_SECOND_USD[selectedModel];
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(perSecond)) return Number.POSITIVE_INFINITY;
  const reserve = khmerSpeech ? KHMER_AUXILIARY_RESERVE_USD : STANDARD_AUXILIARY_RESERVE_USD;
  return Number((seconds * perSecond + reserve).toFixed(4));
};

/**
 * @param {{ duration: number, khmerSpeech?: boolean, model?: string }} options
 */
export const assertVideoGenerationWithinBudget = ({ duration, khmerSpeech = false, model } = {}) => {
  const seconds = Number(duration);
  if (seconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(`Video length is limited to ${MAX_VIDEO_DURATION_SECONDS} seconds to keep generation below $${MAX_VIDEO_GENERATION_COST_USD.toFixed(2)}.`);
  }
  const estimatedCost = estimateVideoGenerationCostUsd({ duration: seconds, khmerSpeech, model });
  if (estimatedCost > MAX_VIDEO_GENERATION_COST_USD) {
    throw new Error(`Estimated video cost $${estimatedCost.toFixed(2)} exceeds the $${MAX_VIDEO_GENERATION_COST_USD.toFixed(2)} limit.`);
  }
  return estimatedCost;
};
