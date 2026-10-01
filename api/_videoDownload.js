const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function isTrustedVideoUrl(value, imageKitEndpoint = process.env.IMAGEKIT_URL_ENDPOINT || '') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    if (['firebasestorage.googleapis.com', 'storage.googleapis.com'].includes(url.hostname)) return true;
    if (url.hostname === 'ik.imagekit.io' || url.hostname.endsWith('.imagekit.io')) return true;
    const endpoint = new URL(imageKitEndpoint);
    const endpointPath = endpoint.pathname.replace(/\/$/, '');
    return endpoint.protocol === 'https:' && url.hostname === endpoint.hostname
      && (!endpointPath || url.pathname === endpointPath || url.pathname.startsWith(`${endpointPath}/`));
  } catch {
    return false;
  }
}

export async function downloadTrustedVideo(value, { timeoutMs = 60000 } = {}) {
  if (!isTrustedVideoUrl(value)) {
    throw Object.assign(new Error('Upload the video to the app storage before publishing.'), { status: 400, code: 'untrusted_video_url' });
  }
  // Follow only redirects that stay on approved media hosts. Native fetch's
  // automatic redirect handling would hide an untrusted/private destination.
  let currentUrl = value;
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (!(response.status >= 300 && response.status < 400)) break;
    const location = response.headers.get('location');
    let nextUrl = '';
    try { if (location) nextUrl = new URL(location, currentUrl).toString(); } catch { /* invalid redirect */ }
    if (!isTrustedVideoUrl(nextUrl) || redirects === 3) {
      throw Object.assign(new Error('The stored video redirected to an untrusted location.'), { status: 400, code: 'untrusted_video_redirect' });
    }
    currentUrl = nextUrl;
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Could not download the video to publish (HTTP ${response.status}).`), { status: 502, code: 'video_download_failed' });
  }
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream'].includes(contentType)) {
    throw Object.assign(new Error('The stored URL did not return a supported video.'), { status: 400, code: 'invalid_video_type' });
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_VIDEO_BYTES) {
    throw Object.assign(new Error('The video exceeds the 50 MB publishing limit.'), { status: 413, code: 'video_too_large' });
  }
  const chunks = [];
  let total = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        total += chunk.byteLength;
        if (total > MAX_VIDEO_BYTES) {
          await reader.cancel();
          throw Object.assign(new Error('The video exceeds the 50 MB publishing limit.'), { status: 413, code: 'video_too_large' });
        }
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    // Supports small Response mocks used in unit tests. Native fetch streams.
    const bytes = Buffer.from(await response.arrayBuffer());
    total = bytes.length;
    chunks.push(bytes);
  }
  if (!total || total > MAX_VIDEO_BYTES) {
    throw Object.assign(new Error(total ? 'The video exceeds the 50 MB publishing limit.' : 'The stored video is empty.'), { status: total ? 413 : 400, code: total ? 'video_too_large' : 'empty_video' });
  }
  return { mimeType: contentType.startsWith('video/') ? contentType : 'video/mp4', buffer: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total) };
}
