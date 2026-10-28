import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const MAX_BYTES = 48 * 1024 * 1024;
const cleanFolder = (folder) => String(folder || 'generation-history').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '_');
const cleanName = (name) => String(name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);

export const r2Enabled = () => process.env.MEDIA_STORAGE_PROVIDER === 'r2';

export function getR2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const publicUrl = String(process.env.R2_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new Error('Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_URL.');
  }
  let url;
  try { url = new URL(publicUrl); } catch { throw new Error('R2_PUBLIC_URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('R2_PUBLIC_URL must be a public HTTPS URL.');
  return { bucket, publicUrl, client: new S3Client({
    region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId, secretAccessKey },
  }) };
}

export function isR2MediaUrl(value) {
  try {
    const base = new URL(getR2Config().publicUrl);
    const candidate = new URL(value);
    const prefix = base.pathname.replace(/\/$/, '');
    return candidate.protocol === 'https:' && candidate.host === base.host && !candidate.username && !candidate.password
      && !candidate.search && !candidate.hash && candidate.pathname.startsWith(`${prefix}/`);
  } catch { return false; }
}

const keyFor = (folder, fileName) => `${cleanFolder(folder)}/${randomUUID()}-${cleanName(fileName)}`;
const publicMediaUrl = (base, key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

export async function createR2UploadAuth({ folder = '/telegram-media', fileName, contentType = 'video/mp4' } = {}) {
  const { client, bucket, publicUrl } = getR2Config();
  if (!/^(video|image|audio)\/[a-z0-9.+-]+$/i.test(contentType) && contentType !== 'application/octet-stream') throw new Error('Unsupported media type.');
  const key = keyFor(folder, fileName || 'media');
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn: 300, signableHeaders: new Set(['content-type']),
  });
  return { provider: 'r2', uploadUrl, method: 'PUT', contentType, key, url: publicMediaUrl(publicUrl, key), maxBytes: MAX_BYTES };
}

export async function uploadR2Bytes({ bytes, contentType, mediaType, folder = '/generation-history', fileName }) {
  if (!bytes?.length || bytes.length > MAX_BYTES) throw new Error('This media file is too large to save. Please use a file under 48 MB.');
  const { client, bucket, publicUrl } = getR2Config();
  const extension = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? (contentType.includes('wav') ? 'wav' : 'mp3') : contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const key = keyFor(folder, fileName || `media-${Date.now()}.${extension}`);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
  return { mediaUrl: publicMediaUrl(publicUrl, key), mediaType, fileId: key, filePath: `/${key}` };
}

export async function uploadR2DataUrl({ mediaDataUrl, mediaType, folder, fileName }) {
  const match = String(mediaDataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid media file data.');
  const contentType = match[1];
  const resolvedType = mediaType || (contentType.startsWith('video/') ? 'video' : contentType.startsWith('audio/') ? 'audio' : 'photo');
  return uploadR2Bytes({ bytes: Buffer.from(match[2], 'base64'), contentType, mediaType: resolvedType, folder, fileName });
}

export async function uploadR2RemoteUrl({ mediaUrl, folder, fileName }) {
  // OpenRouter's unsigned URL can point at a provider-controlled host. Do not
  // fetch that URL from our server: callers fall back to OpenRouter's
  // authenticated content endpoint and upload the returned data URL instead.
  void mediaUrl; void folder; void fileName;
  throw new Error('R2 uses the authenticated provider download for generated videos.');
}
