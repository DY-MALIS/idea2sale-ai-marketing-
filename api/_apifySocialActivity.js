// Optional direct public-social enrichment for competitor scans. Search-engine
// indexes routinely omit recent Facebook posts and TikTok videos, so when an
// Apify token is configured we query the already-discovered official public
// Page/profile URLs directly. This module is deliberately best-effort: billing,
// quota, anti-bot, or actor failures must never fail the core competitor scan.
const APIFY_API_BASE_URL = 'https://api.apify.com/v2/actors';
const DEFAULT_FACEBOOK_ACTOR = 'apify/facebook-posts-scraper';
const DEFAULT_TIKTOK_ACTOR = 'clockworks/tiktok-scraper';
const RESULTS_PER_PROFILE = 14;
const ACTOR_TIMEOUT_SECONDS = 75;

const getToken = () => String(process.env.APIFY_API_TOKEN || '').trim();

export const isApifySocialActivityConfigured = () => !!getToken();

const actorApiId = (value, fallback) => {
  const actor = String(value || fallback).trim().replace('/', '~');
  return /^[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/.test(actor)
    ? actor
    : fallback.replace('/', '~');
};

const truncate = (value, length) => String(value || '').trim().slice(0, length);

const dateOnly = (isoValue, unixValue) => {
  const direct = String(isoValue || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const numeric = Number(unixValue);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const comparableName = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

const socialUrlKey = (value, platform) => {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase().replace(/^(www\.|m\.|web\.)/, '');
    if (platform === 'Facebook' && !['facebook.com', 'fb.com'].includes(hostname)) return '';
    if (platform === 'TikTok' && hostname !== 'tiktok.com') return '';
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
    if (platform === 'Facebook' && path === '/profile.php') {
      return `${hostname}${path}?id=${String(url.searchParams.get('id') || '').toLowerCase()}`;
    }
    return `${hostname}${path}`;
  } catch {
    return '';
  }
};

const tiktokHandle = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return decodeURIComponent(url.pathname.match(/^\/@([^/]+)/)?.[1] || '').toLowerCase();
  } catch {
    return String(value || '').trim().replace(/^@/, '').toLowerCase();
  }
};

const metricDetails = (entries) => entries
  .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
  .map(([label, value]) => `${label}: ${Number(value).toLocaleString('en-US')}`)
  .slice(0, 6);

const runActor = async (actorId, input) => {
  const token = getToken();
  if (!token) return [];
  const endpoint = `${APIFY_API_BASE_URL}/${actorId}/run-sync-get-dataset-items?timeout=${ACTOR_TIMEOUT_SECONDS}`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      // Apify recommends bearer auth because URLs are commonly retained in
      // logs and browser history. Never put this server-only token in a query.
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((ACTOR_TIMEOUT_SECONDS + 10) * 1000),
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

const facebookPageName = (item) => {
  const pageName = item?.user?.pageName;
  if (typeof pageName === 'string') return pageName;
  return pageName?.name || item?.pageName || item?.user?.name || '';
};

const facebookActivities = async (candidates, startDate, endDate) => {
  const pages = candidates.filter((candidate) => socialUrlKey(candidate?.facebookUrl, 'Facebook'));
  if (!pages.length) return [];

  const byUrl = new Map(pages.map((candidate) => [socialUrlKey(candidate.facebookUrl, 'Facebook'), candidate]));
  const byName = new Map(pages.map((candidate) => [comparableName(candidate.name), candidate]));
  const items = await runActor(actorApiId(process.env.APIFY_FACEBOOK_POSTS_ACTOR, DEFAULT_FACEBOOK_ACTOR), {
    startUrls: pages.map((candidate) => ({ url: candidate.facebookUrl })),
    resultsLimit: RESULTS_PER_PROFILE,
    onlyPostsNewerThan: startDate,
    onlyPostsOlderThan: endDate,
    captionText: false,
  });

  return items.map((item) => {
    const candidate = byUrl.get(socialUrlKey(item?.facebookUrl, 'Facebook'))
      || byName.get(comparableName(facebookPageName(item)));
    const date = dateOnly(item?.time || item?.timeCreated, item?.timestamp || item?.timestampCreated);
    const sourceUrl = truncate(item?.url, 300);
    if (!candidate || !date || date < startDate || date > endDate || !socialUrlKey(sourceUrl, 'Facebook')) return null;
    const text = truncate(item?.text || item?.previewTitle || item?.previewDescription, 1200);
    const isVideo = item?.isVideo === true || Number(item?.viewsCount || item?.videoPostViewCount) > 0;
    const label = isVideo ? 'video' : 'post';
    return {
      competitorName: candidate.name,
      date,
      contentType: isVideo ? 'Video' : 'Post',
      title: truncate(item?.previewTitle || text.split(/\r?\n/)[0], 240),
      activity: truncate(text ? `Published a Facebook ${label}: ${text}` : `Published a Facebook ${label}.`, 400),
      summary: text,
      keyDetails: metricDetails([
        ['Reactions', item?.likes ?? item?.topReactionsCount],
        ['Comments', item?.comments],
        ['Shares', item?.shares],
        ['Views', item?.viewsCount ?? item?.videoPostViewCount],
      ]),
      sourceUrl,
    };
  }).filter(Boolean);
};

const tiktokActivities = async (candidates, startDate, endDate) => {
  const profiles = candidates
    .map((candidate) => ({ candidate, handle: tiktokHandle(candidate?.tiktokUrl) }))
    .filter(({ handle }) => handle);
  if (!profiles.length) return [];

  const byHandle = new Map(profiles.map(({ candidate, handle }) => [handle, candidate]));
  const items = await runActor(actorApiId(process.env.APIFY_TIKTOK_ACTOR, DEFAULT_TIKTOK_ACTOR), {
    profiles: profiles.map(({ handle }) => handle),
    profileScrapeSections: ['videos'],
    profileSorting: 'latest',
    excludePinnedPosts: false,
    resultsPerPage: RESULTS_PER_PROFILE,
    oldestPostDateUnified: startDate,
    newestPostDate: endDate,
    maxFollowersPerProfile: 0,
    maxFollowingPerProfile: 0,
    commentsPerPost: 0,
    topLevelCommentsPerPost: 0,
    maxRepliesPerComment: 0,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
    shouldDownloadAvatars: false,
    shouldDownloadMusicCovers: false,
  });

  return items.map((item) => {
    const handle = tiktokHandle(item?.authorMeta?.profileUrl || item?.authorMeta?.name);
    const candidate = byHandle.get(handle);
    const date = dateOnly(item?.createTimeISO, item?.createTime);
    const sourceUrl = truncate(item?.webVideoUrl, 300);
    if (!candidate || !date || date < startDate || date > endDate || !socialUrlKey(sourceUrl, 'TikTok')) return null;
    const text = truncate(item?.text, 1200);
    return {
      competitorName: candidate.name,
      date,
      contentType: 'Video',
      title: truncate(text.split(/\r?\n/)[0] || 'TikTok video', 240),
      activity: truncate(text ? `Published a TikTok video: ${text}` : 'Published a TikTok video.', 400),
      summary: text,
      keyDetails: metricDetails([
        ['Likes', item?.diggCount],
        ['Comments', item?.commentCount],
        ['Shares', item?.shareCount],
        ['Plays', item?.playCount],
      ]),
      sourceUrl,
    };
  }).filter(Boolean);
};

export async function fetchApifySocialActivity({ candidates = [], startDate = '', endDate = '' }) {
  if (!isApifySocialActivityConfigured() || !Array.isArray(candidates) || !candidates.length) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];

  const [facebook, tiktok] = await Promise.all([
    facebookActivities(candidates, startDate, endDate),
    tiktokActivities(candidates, startDate, endDate),
  ]);
  return [...facebook, ...tiktok];
}
