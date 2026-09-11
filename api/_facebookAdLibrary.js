// Wraps Meta's public Ad Library API (https://www.facebook.com/ads/library/api)
// so competitor research reads only what advertisers already chose to run
// publicly as ads -- not personal profiles, posts, or private user data, which
// Facebook's terms (and most privacy law) put off-limits to automated
// collection. No login/session is used; this is a plain server-to-server
// Graph API call with an app access token.
const AD_LIBRARY_ENDPOINT = 'https://graph.facebook.com/v21.0/ads_archive';
const AD_LIBRARY_FIELDS = [
  'page_name',
  'ad_creative_bodies',
  'ad_creative_link_titles',
  'ad_creative_link_captions',
  'ad_delivery_start_time',
  'ad_snapshot_url',
  'publisher_platforms',
].join(',');

export async function searchCompetitorAds({ searchTerms, countries }) {
  const accessToken = (process.env.FACEBOOK_ACCESS_TOKEN || '').trim();
  if (!accessToken) {
    const error = new Error('Facebook competitor research is not configured on the server. Set FACEBOOK_ACCESS_TOKEN.');
    error.code = 'missing_token';
    throw error;
  }

  const reachedCountries = Array.isArray(countries) && countries.length ? countries : ['US'];
  const params = new URLSearchParams({
    access_token: accessToken,
    search_terms: searchTerms,
    ad_type: 'ALL',
    ad_active_status: 'ALL',
    ad_reached_countries: JSON.stringify(reachedCountries),
    fields: AD_LIBRARY_FIELDS,
    limit: '25',
  });

  const response = await fetch(`${AD_LIBRARY_ENDPOINT}?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Meta Ad Library request failed (status ${response.status}).`);
  }

  return (Array.isArray(data?.data) ? data.data : []).map((ad) => ({
    pageName: ad.page_name || 'Unknown Page',
    bodies: Array.isArray(ad.ad_creative_bodies) ? ad.ad_creative_bodies : [],
    linkTitles: Array.isArray(ad.ad_creative_link_titles) ? ad.ad_creative_link_titles : [],
    linkCaptions: Array.isArray(ad.ad_creative_link_captions) ? ad.ad_creative_link_captions : [],
    startDate: ad.ad_delivery_start_time || null,
    snapshotUrl: ad.ad_snapshot_url || null,
    platforms: Array.isArray(ad.publisher_platforms) ? ad.publisher_platforms : [],
  }));
}
