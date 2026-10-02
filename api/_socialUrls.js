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
const FACEBOOK_NON_PAGE_PATHS = new Set([
  'reel', 'watch', 'groups', 'events', 'profile.php', 'photo.php',
  'permalink.php', 'story.php', 'search', 'marketplace', 'hashtag', 'ads',
  'posts', 'videos', 'people', 'sharer', 'sharer.php', 'share', 'dialog',
  'login', 'plugins', 'help', 'privacy', 'policies',
]);

// A public post URL may reveal its Page slug; an opaque reel URL does not.
// Use this for business identity, never as a post-existence check.
export const facebookBusinessPageKey = (value) => {
  if (!validFacebookUrl(value)) return '';
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    const first = (parts[0] || '').toLowerCase();
    if (!first || FACEBOOK_NON_PAGE_PATHS.has(first)) return '';
    if (first === 'pages') return parts[2] ? `pages/${parts[2].toLowerCase()}` : '';
    if (first === 'pg') {
      const page = (parts[1] || '').toLowerCase();
      return page && !FACEBOOK_NON_PAGE_PATHS.has(page) ? page : '';
    }
    return first;
  } catch {
    return '';
  }
};
export const validTikTokUrl = (value) => /^https:\/\/(?:www\.)?tiktok\.com\/@[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(value);
export const validLinkedInUrl = (value) => /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:company|school|showcase)\/[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(value);
export const validLinkedInPostUrl = (value) => /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:posts\/|feed\/update\/)[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(value);
export const isSupportedPublicSocialUrl = (value) => (
  validFacebookUrl(value)
  || validTikTokUrl(value)
  || validLinkedInUrl(value)
  || validLinkedInPostUrl(value)
);
