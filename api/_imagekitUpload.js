import { createHmac, randomUUID } from 'crypto';
import { formatImageKitUploadError } from '../shared/imageKitError.js';
import {
  applyImageKitAudioExtractionTransform as applyAudioExtractionTransform,
  applyImageKitDeliveryTransform as applyDeliveryTransform,
  applyImageKitLogoOverlay as applyLogoOverlay,
  applyImageKitMuteTransform as applyMuteTransform,
  getOriginalImageKitUrl,
} from '../shared/imageKitUrl.js';

const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;

export const getImageKitConfig = () => {
  const publicKey = (process.env.IMAGEKIT_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
  const urlEndpoint = (process.env.IMAGEKIT_URL_ENDPOINT || '').trim().replace(/\/$/, '');
  if (!publicKey || !privateKey || !urlEndpoint) {
    throw new Error('ImageKit is not configured (IMAGEKIT_PUBLIC_KEY / IMAGEKIT_PRIVATE_KEY / IMAGEKIT_URL_ENDPOINT).');
  }
  let endpoint;
  try {
    endpoint = new URL(urlEndpoint);
  } catch {
    throw new Error('IMAGEKIT_URL_ENDPOINT must be a valid HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:') throw new Error('IMAGEKIT_URL_ENDPOINT must use HTTPS.');
  return { publicKey, privateKey, urlEndpoint, endpoint };
};

export const createImageKitUploadAuth = () => {
  const { publicKey, privateKey } = getImageKitConfig();
  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 3600;
  const signature = createHmac('sha1', privateKey).update(`${token}${expire}`).digest('hex');
  return { publicKey, token, expire, signature, uploadUrl: IMAGEKIT_UPLOAD_URL, maxBytes: MAX_UPLOAD_BYTES };
};

const configuredEndpoint = () => process.env.IMAGEKIT_URL_ENDPOINT || '';

export const applyImageKitDeliveryTransform = (mediaUrl, mediaType) =>
  applyDeliveryTransform(mediaUrl, mediaType, configuredEndpoint());

export const applyImageKitMuteTransform = (mediaUrl) =>
  applyMuteTransform(mediaUrl, configuredEndpoint());

export const applyImageKitAudioExtractionTransform = (mediaUrl) =>
  applyAudioExtractionTransform(
    getOriginalImageKitUrl(mediaUrl, configuredEndpoint()),
    configuredEndpoint(),
  );

export const applyImageKitLogoOverlay = (videoUrl, logoFilePath) =>
  applyLogoOverlay(videoUrl, logoFilePath, configuredEndpoint());

export const isImageKitMediaUrl = (mediaUrl) => {
  try {
    const { endpoint } = getImageKitConfig();
    const candidate = new URL(mediaUrl);
    const endpointPath = endpoint.pathname.replace(/\/$/, '');
    return candidate.protocol === 'https:'
      && candidate.hostname === endpoint.hostname
      && (!endpointPath || candidate.pathname === endpointPath || candidate.pathname.startsWith(`${endpointPath}/`));
  } catch {
    return false;
  }
};

const fileExtensionFor = (contentType, mediaType) => {
  if (mediaType === 'video' || contentType.startsWith('video/')) return 'mp4';
  if (mediaType === 'audio' || contentType.startsWith('audio/')) return contentType.includes('wav') ? 'wav' : 'mp3';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
};

export const uploadMediaDataUrl = async ({ mediaDataUrl, mediaType, folder = '/generation-history', fileName }) => {
  if (!mediaDataUrl) return { mediaUrl: '', mediaType: null };
  const match = String(mediaDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid media file data.');

  const contentType = match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('This media file is too large to save. Please use a file under 48 MB.');
  }

  const { privateKey, publicKey } = getImageKitConfig();
  const resolvedType = mediaType || (contentType.startsWith('video/') ? 'video' : contentType.startsWith('audio/') ? 'audio' : 'photo');
  const resolvedName = String(fileName || `media-${Date.now()}.${fileExtensionFor(contentType, resolvedType)}`)
    .replace(/[^A-Za-z0-9.-]/g, '_');
  const form = new FormData();
  form.set('file', mediaDataUrl);
  form.set('fileName', resolvedName);
  form.set('folder', folder.startsWith('/') ? folder : `/${folder}`);
  form.set('useUniqueFileName', 'true');

  const response = await fetch(IMAGEKIT_UPLOAD_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.url) {
    throw new Error(formatImageKitUploadError(data?.message || data?.error?.message, [publicKey, privateKey]));
  }

  return {
    mediaUrl: applyImageKitDeliveryTransform(data.url, resolvedType),
    mediaType: resolvedType,
    fileId: data.fileId,
    filePath: data.filePath,
    ...(Number(data.duration) > 0 ? { duration: Number(data.duration) } : {}),
  };
};
