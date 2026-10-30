import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { createCloudinaryUploadAuth, isCloudinaryMediaUrl } from '../api/_cloudinaryStorage.js';

dotenv.config({ path: '.env' });
process.env.CLOUDINARY_FALLBACK_ENABLED = 'true';

const auth = createCloudinaryUploadAuth({ folder: '/verification' });
const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_SECRET: secret } = process.env;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');
let publicId = '';
try {
  const form = new FormData();
  form.set('file', new Blob([pixel], { type: 'image/png' }), 'verification.png');
  form.set('api_key', auth.apiKey);
  form.set('timestamp', String(auth.timestamp));
  form.set('signature', auth.signature);
  form.set('folder', auth.cloudinaryFolder);
  const response = await fetch(auth.uploadUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !isCloudinaryMediaUrl(data.secure_url) || !data.public_id) {
    throw new Error(`Signed Cloudinary upload failed: HTTP ${response.status}; ${String(data.error?.message || '').slice(0, 200)}`);
  }
  publicId = data.public_id;
  const playback = await fetch(data.secure_url, { signal: AbortSignal.timeout(30000) });
  if (!playback.ok || !String(playback.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error(`Cloudinary playback failed: HTTP ${playback.status}`);
  }
  console.log('PASS: signed Cloudinary upload and playback.');
} finally {
  if (publicId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHash('sha256').update(`public_id=${publicId}&timestamp=${timestamp}${secret}`).digest('hex');
    const form = new FormData();
    form.set('public_id', publicId);
    form.set('timestamp', String(timestamp));
    form.set('api_key', auth.apiKey);
    form.set('signature', signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.result !== 'ok') throw new Error(`Cloudinary smoke asset cleanup failed: HTTP ${response.status}`);
    console.log('PASS: smoke asset removed.');
  }
}
