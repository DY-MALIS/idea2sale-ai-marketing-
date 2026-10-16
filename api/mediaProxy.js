import { isImageKitMediaUrl } from './_imagekitUpload.js';

// Lets the browser pull bytes from our own ImageKit-hosted media as a same-
// origin fetch instead of a cross-origin one. A generated video/image is
// hosted remotely (ImageKit), and <video>/<img> playback and a plain
// download link both work fine with that -- but reading the response body
// via fetch() (needed to turn it into a File for the TikTok/YouTube
// scheduler's upload field) requires CORS, which ImageKit's delivery
// domain does not grant. That silently failed before (SchedulerHub.tsx's
// handoff effect), leaving the video field on "No file chosen" every time,
// forcing a manual download-then-reupload for something already hosted.
// Restricting to our own configured ImageKit endpoint (isImageKitMediaUrl)
// keeps this from becoming an open server-side-request-forgery proxy.
const MAX_PROXY_BYTES = 64 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = String(req.query?.url || '');
  if (!url || !isImageKitMediaUrl(url)) {
    return res.status(400).json({ error: 'Invalid media URL.' });
  }

  let upstream;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch {
    return res.status(502).json({ error: 'Could not fetch this media.' });
  }
  if (!upstream.ok) return res.status(502).json({ error: `Upstream returned ${upstream.status}.` });

  const contentLength = Number(upstream.headers.get('content-length') || 0);
  if (contentLength > MAX_PROXY_BYTES) return res.status(413).json({ error: 'This media file is too large to proxy.' });

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length > MAX_PROXY_BYTES) return res.status(413).json({ error: 'This media file is too large to proxy.' });

  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.status(200).send(buffer);
}
