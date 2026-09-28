const GRAPH_API_VERSION = 'v19.0';
// Reels processing (Instagram transcodes/validates the video) is not
// instant -- poll status_code until it flips to FINISHED (or ERROR) instead
// of publishing immediately, since publishing a container that isn't ready
// yet fails outright.
const CONTAINER_POLL_ATTEMPTS = 24;
const CONTAINER_POLL_DELAY_MS = 5000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function graphRequest(path, { method = 'GET', params } = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  if (method === 'GET' && params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  const response = await fetch(url, {
    method,
    ...(method !== 'GET' ? { body: new URLSearchParams(params) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error?.message || `Instagram Graph API returned HTTP ${response.status}`);
    error.status = response.status >= 400 ? response.status : 500;
    error.code = data?.error?.code || 'instagram_publish_failed';
    throw error;
  }
  return data;
}

// Instagram has no text-only post type -- every publish needs an image or
// video, unlike Facebook's /feed endpoint.
export async function publishToInstagram({ igUserId, accessToken, caption, mediaUrl }) {
  if (!igUserId || !accessToken) {
    const error = new Error('Instagram is not connected. Set INSTAGRAM_BUSINESS_ACCOUNT_ID and FACEBOOK_PAGE_ACCESS_TOKEN.');
    error.status = 401;
    error.code = 'not_configured';
    throw error;
  }
  if (!mediaUrl) {
    const error = new Error('Instagram requires a photo or video -- text-only posts are not supported.');
    error.status = 400;
    error.code = 'media_required';
    throw error;
  }

  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl);
  const container = await graphRequest(`${igUserId}/media`, {
    method: 'POST',
    params: {
      access_token: accessToken,
      caption: caption || '',
      ...(isVideo ? { media_type: 'REELS', video_url: mediaUrl } : { image_url: mediaUrl }),
    },
  });
  const creationId = container.id;
  if (!creationId) throw new Error('Instagram did not return a media container id.');

  if (isVideo) {
    let ready = false;
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
      const status = await graphRequest(creationId, { params: { fields: 'status_code', access_token: accessToken } });
      if (status.status_code === 'FINISHED') { ready = true; break; }
      if (status.status_code === 'ERROR') throw new Error('Instagram failed to process the video container.');
      await wait(CONTAINER_POLL_DELAY_MS);
    }
    if (!ready) throw new Error('Instagram video processing timed out.');
  }

  const published = await graphRequest(`${igUserId}/media_publish`, {
    method: 'POST',
    params: { access_token: accessToken, creation_id: creationId },
  });
  return { mediaId: published.id || null };
}
