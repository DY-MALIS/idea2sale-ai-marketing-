import { createHash } from 'node:crypto';

const MAX_BYTES = 48 * 1024 * 1024;

export const cloudinaryFallbackEnabled = () => process.env.CLOUDINARY_FALLBACK_ENABLED === 'true';

export const getCloudinaryConfig = () => {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(cloudName) || !/^\d+$/.test(apiKey) || !apiSecret) {
    throw new Error('Cloudinary fallback is not configured on the server.');
  }
  return { cloudName, apiKey, apiSecret };
};

const normalizeFolder = (folder) => {
  const parts = String(folder || '/generation-history').split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('Invalid media folder.');
  }
  return `aime/${parts.join('/')}`;
};

const uploadUrlFor = (cloudName) => `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

export const createCloudinaryUploadAuth = ({ folder = '/generation-history' } = {}) => {
  if (!cloudinaryFallbackEnabled()) throw new Error('Cloudinary fallback is disabled.');
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const uploadFolder = normalizeFolder(folder);
  const signature = createHash('sha256').update(`folder=${uploadFolder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  return {
    provider: 'cloudinary', uploadUrl: uploadUrlFor(cloudName), apiKey,
    timestamp, signature, cloudinaryFolder: uploadFolder, maxBytes: MAX_BYTES,
  };
};

export const isCloudinaryMediaUrl = (value) => {
  try {
    const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(cloudName)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && url.hostname === 'res.cloudinary.com'
      && new RegExp(`^/${cloudName}/(?:image|video|raw)/upload/`).test(url.pathname);
  } catch {
    return false;
  }
};

export const isImageKitQuotaError = (status, message) => {
  const text = String(message || '').toLowerCase();
  return status === 402 || /(?:storage|bandwidth|video (?:processing )?units|quota|allowance).{0,80}(?:limit|exceed|exhaust|full)|(?:limit|exceed|exhaust|full).{0,80}(?:storage|bandwidth|video (?:processing )?units|quota|allowance)/i.test(text);
};

export const uploadCloudinaryFile = async ({ file, mediaType, folder = '/generation-history' }) => {
  const auth = createCloudinaryUploadAuth({ folder });
  const form = new FormData();
  form.set('file', file);
  form.set('api_key', auth.apiKey);
  form.set('timestamp', String(auth.timestamp));
  form.set('signature', auth.signature);
  form.set('folder', auth.cloudinaryFolder);
  const response = await fetch(auth.uploadUrl, { method: 'POST', signal: AbortSignal.timeout(120000), body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !isCloudinaryMediaUrl(data.secure_url)) {
    throw new Error(`Cloudinary upload failed (HTTP ${response.status}).`);
  }
  return {
    mediaUrl: data.secure_url,
    mediaType: mediaType || (data.resource_type === 'video' ? 'video' : 'photo'),
    fileId: data.asset_id,
    filePath: data.public_id,
    ...(Number(data.duration) > 0 ? { duration: Number(data.duration) } : {}),
  };
};
