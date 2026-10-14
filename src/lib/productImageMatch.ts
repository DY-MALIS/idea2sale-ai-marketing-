import type { BusinessProductImage } from '../types';

// Live Voice, AI Agent chat, and Facebook Scanner all auto-submit a video
// request with no render pause for the manual picker in VideoVoice.tsx, so a
// saved product can never be explicitly selected for those triggers. Falling
// back to matching the request's own text against a saved product's label
// (the same "exact name" pattern already used elsewhere for businessName)
// still lets an explicitly named product get picked up automatically.
export const resolveAutomationProductImageUrl = (
  promptText: string,
  productImages: BusinessProductImage[],
): string | undefined => {
  const haystack = promptText.toLowerCase();
  return productImages.find((image) => image.label && haystack.includes(image.label.toLowerCase()))?.imageUrl;
};
