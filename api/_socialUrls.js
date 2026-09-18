// Shared helpers for recognizing and shape-validating public social profile/post
// URLs (Facebook, TikTok, LinkedIn). Used by both _webBusinessSearch.js and
// _competitorResearch.js so a real public social URL is verified the same way
// everywhere: these platforms commonly reject server-side HEAD/GET checks even
// for genuine public pages, so a URL that already matches the platform's real
// public-page shape is trusted on its shape instead of being dropped for
// failing an HTTP reachability check.
export const socialPlatformFromUrl = (value) => {
  try {
    const { hostname } = new URL(String(value || ''));
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.com') return 'Facebook';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok';
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LinkedIn';
  } catch {
    // Non-URLs are treated as ordinary web evidence and rejected downstream.
  }
  return 'Web';
};

export const validFacebookUrl = (value) => /^https:\/\/(?:(?:www|m)\.)?(?:facebook\.com|fb\.com)\/(?!profile\.php(?:\?|$))[^\s]+/i.test(value);
export const validTikTokUrl = (value) => /^https:\/\/(?:www\.)?tiktok\.com\/@[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(value);
export const validLinkedInUrl = (value) => /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:company|school|showcase)\//i.test(value);
export const validLinkedInPostUrl = (value) => /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:posts\/|feed\/update\/)/i.test(value);
export const isSupportedPublicSocialUrl = (value) => (
  validFacebookUrl(value)
  || validTikTokUrl(value)
  || validLinkedInUrl(value)
  || validLinkedInPostUrl(value)
);
