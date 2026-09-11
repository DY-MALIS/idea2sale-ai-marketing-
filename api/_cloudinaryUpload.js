import { createHash } from 'crypto';

const getCloudinaryConfig = () => {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).');
  }
  return { cloudName, apiKey, apiSecret };
};

export const applyCloudinaryDeliveryTransform = (secureUrl, mediaType) => {
  const transform = mediaType === 'video' ? 'q_auto,w_1280' : 'w_1280,q_auto,f_auto';
  const marker = mediaType === 'video' ? '/video/upload/' : '/image/upload/';
  const index = secureUrl.indexOf(marker);
  if (index === -1) return secureUrl;
  const insertAt = index + marker.length;
  const rest = secureUrl.slice(insertAt);
  if (rest.startsWith(transform)) return secureUrl;
  return `${secureUrl.slice(0, insertAt)}${transform}/${rest}`;
};

// Shared with api/telegram/run-scheduled.js's own copy of this logic (kept
// separate rather than importing from there, to avoid touching the
// production Telegram cron pipeline for an unrelated feature).
export const uploadMediaDataUrl = async ({ mediaDataUrl, mediaType, folder = 'generation-history' }) => {
  if (!mediaDataUrl) return { mediaUrl: '', mediaType: null };

  const match = String(mediaDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid media file data.');
  }

  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = 48 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error('This media file is too large to save. Please use a file under 48 MB.');
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(paramsToSign + apiSecret).digest('hex');

  const form = new URLSearchParams();
  form.set('file', mediaDataUrl);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('signature', signature);
  form.set('folder', folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Cloudinary upload failed.');
  }

  const resolvedMediaType = mediaType || (data.resource_type === 'video' ? 'video' : contentType.startsWith('video/') ? 'video' : 'photo');

  return {
    mediaUrl: applyCloudinaryDeliveryTransform(data.secure_url, resolvedMediaType),
    mediaType: resolvedMediaType,
    publicId: data.public_id,
  };
};
