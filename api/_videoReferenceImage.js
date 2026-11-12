import sharp from 'sharp';
import { isImageKitMediaUrl } from './_imagekitUpload.js';
import { getOriginalImageKitUrl } from '../shared/imageKitUrl.js';

const MIN_PROVIDER_SIDE = 300;
const TARGET_SIDE = 512;
const MAX_SIDE = 4096;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const imageBytesFromDataUrl = (source) => {
  const match = /^data:image\/(jpeg|jpg|png|webp|avif|gif|bmp|tiff|heif|heic);base64,([A-Za-z0-9+/=]+)$/i.exec(String(source || ''));
  if (!match) throw new Error('The video reference image must be a supported image file.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('The video reference image must be under 10 MB.');
  return { bytes, declaredFormat: match[1].toLowerCase() };
};

const enlargeIfNeeded = async (bytes, declaredFormat = '') => {
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new Error('The video reference image could not be decoded. Choose a valid image.');
  }
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  if (!(width > 0 && height > 0)) throw new Error('The video reference image has no measurable dimensions.');
  const aspectRatio = width / height;
  if (width >= MIN_PROVIDER_SIDE && height >= MIN_PROVIDER_SIDE
    && aspectRatio >= 0.4 && aspectRatio <= 2.5
    && Math.max(width, height) <= MAX_SIDE
    && (metadata.format === 'jpeg' || metadata.format === 'png')) {
    return declaredFormat && declaredFormat !== metadata.format
      ? `data:image/${metadata.format};base64,${bytes.toString('base64')}`
      : null;
  }
  // Very wide or tall photos need a neutral canvas as well as enough pixels.
  // Contain keeps the entire user image visible instead of cropping its edges.
  if (aspectRatio < 0.4 || aspectRatio > 2.5) {
    const contained = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(1024, 1024, { fit: 'contain', background: '#ffffff' })
      .png()
      .toBuffer();
    return `data:image/png;base64,${contained.toString('base64')}`;
  }
  if (Math.max(width, height) > MAX_SIDE) {
    const reduced = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside' })
      .png()
      .toBuffer();
    return `data:image/png;base64,${reduced.toString('base64')}`;
  }
  if (width >= MIN_PROVIDER_SIDE && height >= MIN_PROVIDER_SIDE) {
    // Veo accepts JPEG/PNG, while the browser uploader and saved product
    // gallery may supply WebP, AVIF, or another decodable image format.
    const converted = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${converted.toString('base64')}`;
  }
  const scale = TARGET_SIDE / Math.min(width, height);
  const targetWidth = Math.ceil(width * scale);
  const targetHeight = Math.ceil(height * scale);
  if (Math.max(targetWidth, targetHeight) > MAX_SIDE) {
    throw new Error('The video reference image is too narrow to enlarge safely. Choose a larger image.');
  }
  const enlarged = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .png()
    .toBuffer();
  return `data:image/png;base64,${enlarged.toString('base64')}`;
};

export const ensureVideoImageDataUrl = async (source) => {
  const { bytes, declaredFormat } = imageBytesFromDataUrl(source);
  return await enlargeIfNeeded(bytes, declaredFormat) || source;
};

const downloadStoredImage = async (url) => {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error('The saved product image could not be downloaded.');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    throw new Error('The saved product image exceeds 10 MB.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('The saved product image exceeds 10 MB.');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) throw new Error('The saved product image is empty.');
  return Buffer.concat(chunks);
};

export const prepareVideoProductImageUrl = async (source, uploadMediaDataUrl) => {
  if (!source) return '';
  const isDataUrl = String(source).startsWith('data:');
  if (!isDataUrl && !isImageKitMediaUrl(source)) {
    throw new Error('The saved product image must come from the connected media storage.');
  }
  const originalUrl = isDataUrl ? '' : getOriginalImageKitUrl(source, process.env.IMAGEKIT_URL_ENDPOINT || '');
  const decoded = isDataUrl ? imageBytesFromDataUrl(source) : null;
  const bytes = decoded?.bytes || await downloadStoredImage(originalUrl);
  const enlarged = await enlargeIfNeeded(bytes, decoded?.declaredFormat || '');
  if (!enlarged && originalUrl) return originalUrl;
  const mediaDataUrl = enlarged || source;
  const uploaded = await uploadMediaDataUrl({ mediaDataUrl, mediaType: 'photo', folder: '/video-references' });
  const preparedUrl = getOriginalImageKitUrl(uploaded?.mediaUrl, process.env.IMAGEKIT_URL_ENDPOINT || '');
  if (!/^https:\/\//.test(preparedUrl)) throw new Error('Could not store a usable product image for video generation.');
  return preparedUrl;
};
