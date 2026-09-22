// Facebook blocks unauthenticated scraping of Page/post content, and generic
// web search does not index it either -- see api/_competitorResearch.js for
// the live tests that confirmed both. Meta's Ad Library is the one Facebook
// data source that is intentionally public (ad transparency requirement), so
// it is the only reliable way to surface real Facebook activity: it covers
// currently/recently running ads, not organic posts.
const META_GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';

const getAccessToken = () => String(process.env.META_AD_LIBRARY_ACCESS_TOKEN || '').trim();

export const isMetaAdLibraryConfigured = () => !!getAccessToken();

const truncate = (value, length) => String(value || '').trim().slice(0, length);

// Ad Library dates are full timestamps (e.g. "2026-09-18T00:00:00-0700");
// callers elsewhere in this app compare against a plain YYYY-MM-DD window.
const toDateOnly = (value) => {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

// One ad can have several creative variants (ad_creative_bodies is an array);
// this app's activity shape wants one description per ad, so the longest/most
// informative variant is used.
const longestOf = (values) => (Array.isArray(values) ? values : [])
  .map((value) => String(value || '').trim())
  .filter(Boolean)
  .sort((left, right) => right.length - left.length)[0] || '';

export async function fetchMetaAdLibraryActivity({ businessName, countryCode = 'KH', startDate = '', endDate = '' }) {
  const accessToken = getAccessToken();
  const name = String(businessName || '').trim();
  if (!accessToken || !name) return [];

  const params = new URLSearchParams({
    access_token: accessToken,
    search_terms: name,
    search_type: 'KEYWORD_UNORDERED',
    ad_reached_countries: JSON.stringify([String(countryCode || 'KH').trim().toUpperCase() || 'KH']),
    ad_active_status: 'ALL',
    fields: 'page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url',
    limit: '25',
  });
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) params.set('ad_delivery_date_min', startDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) params.set('ad_delivery_date_max', endDate);

  let response;
  try {
    response = await fetch(`${META_GRAPH_BASE_URL}/ads_archive?${params.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return [];
  }

  const data = await response.json().catch(() => ({}));
  // Best-effort enrichment, not a required source -- an expired token, a rate
  // limit, or a transient Graph API error should not fail the whole
  // competitor lookup, so failures here are swallowed rather than thrown.
  if (!response.ok) return [];

  return (Array.isArray(data?.data) ? data.data : [])
    .map((ad) => {
      const date = toDateOnly(ad?.ad_delivery_start_time);
      const title = truncate(longestOf(ad?.ad_creative_link_titles), 240);
      const body = truncate(longestOf(ad?.ad_creative_bodies), 1200);
      if (!date || (!title && !body)) return null;
      return {
        date,
        contentType: 'Ad',
        title,
        activity: title || body.slice(0, 200) || 'Ran a Facebook ad.',
        summary: body,
        sourceUrl: truncate(ad?.ad_snapshot_url, 300),
      };
    })
    .filter((activity) => activity && /^https?:\/\//i.test(activity.sourceUrl));
}
