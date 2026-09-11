// Wraps Google's Places API (Text Search + Place Details) so local business
// research reads only public listing data businesses already chose to publish
// on Google Maps (name, address, phone, website, rating) -- not private data.
// Used as a Cambodia-friendly alternative to Meta's Ad Library API, which only
// supports political/social-issue ads worldwide or any ads in the UK/EU.
const TEXT_SEARCH_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/details/json';
const DETAILS_FIELDS = ['name', 'formatted_address', 'formatted_phone_number', 'international_phone_number', 'website', 'url', 'rating', 'user_ratings_total', 'business_status'].join(',');

export async function searchLocalBusinesses({ searchTerms, region = 'kh', limit = 10 }) {
  const apiKey = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Local business lookup is not configured on the server. Set GOOGLE_PLACES_API_KEY.');
    error.code = 'missing_token';
    throw error;
  }

  const searchParams = new URLSearchParams({
    query: searchTerms,
    region,
    key: apiKey,
  });

  const searchResponse = await fetch(`${TEXT_SEARCH_ENDPOINT}?${searchParams.toString()}`);
  const searchData = await searchResponse.json().catch(() => ({}));
  if (!searchResponse.ok || (searchData.status && searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS')) {
    throw new Error(searchData?.error_message || `Google Places request failed (status ${searchData?.status || searchResponse.status}).`);
  }

  const candidates = (Array.isArray(searchData?.results) ? searchData.results : []).slice(0, limit);

  const detailed = await Promise.all(candidates.map(async (place) => {
    const detailsParams = new URLSearchParams({
      place_id: place.place_id,
      fields: DETAILS_FIELDS,
      key: apiKey,
    });
    try {
      const detailsResponse = await fetch(`${DETAILS_ENDPOINT}?${detailsParams.toString()}`);
      const detailsData = await detailsResponse.json().catch(() => ({}));
      const result = detailsData?.result || {};
      return {
        businessName: result.name || place.name || 'Unknown Business',
        address: result.formatted_address || place.formatted_address || null,
        phone: result.formatted_phone_number || result.international_phone_number || null,
        website: result.website || null,
        mapsUrl: result.url || null,
        rating: typeof result.rating === 'number' ? result.rating : (typeof place.rating === 'number' ? place.rating : null),
        ratingCount: typeof result.user_ratings_total === 'number' ? result.user_ratings_total : null,
        businessStatus: result.business_status || place.business_status || null,
        types: Array.isArray(place.types) ? place.types : [],
      };
    } catch {
      return {
        businessName: place.name || 'Unknown Business',
        address: place.formatted_address || null,
        phone: null,
        website: null,
        mapsUrl: null,
        rating: typeof place.rating === 'number' ? place.rating : null,
        ratingCount: null,
        businessStatus: place.business_status || null,
        types: Array.isArray(place.types) ? place.types : [],
      };
    }
  }));

  return detailed;
}
