import { startKhmerVideoJob } from '../_khmerVideo.js';
import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { randomBytes } from 'crypto';
import { Client as QStashClient } from '@upstash/qstash';
import sharp from 'sharp';
import { logAudit } from '../_audit.js';
import { claimPendingPost, findRecentDuplicateTelegramPost } from '../_telegramClaim.js';
import { getScheduledCallbackBaseUrl } from '../_callbackUrl.js';
import { notifyAdmins } from '../_alert.js';
import { runUsageChecks } from '../_usageMonitor.js';
import { checkRateLimit, getClientIp } from '../_rateLimit.js';
import { generateOpenRouterImage, startOpenRouterVideo } from '../_openrouter.js';
import { preparePlanVideoSpeech } from '../_videoSpeech.js';
import { generateKhmerSpeech } from '../_khmerNarration.js';
import { applyPosterTextOverlay } from '../_posterOverlay.js';
import { getUntransformedImageKitVideoUrl } from '../../shared/imageKitUrl.js';
import { telegramDestinationFromProfile } from '../../shared/telegramDestination.js';
import { queueContentPlanDestinations } from '../_contentPlanFanout.js';
import reviewVideoHandler from './_review-video.js';
import {
  applyImageKitDeliveryTransform,
  applyImageKitLogoOverlay,
  createImageKitUploadAuth,
  isImageKitMediaUrl,
  uploadMediaDataUrl as uploadImageKitMediaDataUrl,
} from '../_imagekitUpload.js';

export { applyImageKitDeliveryTransform, applyImageKitLogoOverlay, initFirebaseAdmin };

export const GENERATED_VIDEO_STATUSES = Object.freeze(['DONE', 'PROCESSING', 'REVIEW', 'READY']);

// A replacement can cancel an item while a paid provider call is in flight.
// Do not turn that cancelled item back into PROCESSING/FAILED afterwards.
const updateActivePlanItem = (db, ref, fields) => db.runTransaction(async (tx) => {
  const fresh = await tx.get(ref);
  if (!fresh.exists || fresh.data()?.status !== 'PROCESSING' || fresh.data()?.supersededBy) return false;
  tx.update(ref, fields);
  return true;
});

export const isStalledContentPlanVideoStart = (item, nowMs = Date.now()) => {
  const startedAtMs = item?.processingAt?.toMillis?.();
  return item?.status === 'PROCESSING' && item?.type === 'video' && !item?.videoJobId
    && typeof startedAtMs === 'number' && nowMs - startedAtMs > 10 * 60 * 1000;
};

// Server-side equivalent of PosterGen.tsx's applyLogoWatermark (that one uses
// the browser Canvas API, unavailable here) -- same top-left placement/ratios,
// so a Content Plan image gets the business's actual logo instead of shipping
// as a generic AI image with no real branding on it.
const LOGO_MARGIN_RATIO = 0.04;
const LOGO_WIDTH_RATIO = 0.16;
export const applyLogoWatermarkServer = async (imageDataUrl, logoDataUrl) => {
  if (!logoDataUrl) return imageDataUrl;
  try {
    const baseMatch = String(imageDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
    const logoMatch = String(logoDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
    if (!baseMatch || !logoMatch) return imageDataUrl;
    const baseBuffer = Buffer.from(baseMatch[2], 'base64');
    const logoBuffer = Buffer.from(logoMatch[2], 'base64');
    const baseImage = sharp(baseBuffer);
    const { width } = await baseImage.metadata();
    if (!width) return imageDataUrl;
    const margin = Math.round(width * LOGO_MARGIN_RATIO);
    const logoWidth = Math.round(width * LOGO_WIDTH_RATIO);
    const resizedLogo = await sharp(logoBuffer).resize({ width: logoWidth }).toBuffer();
    const composited = await baseImage
      .composite([{ input: resizedLogo, top: margin, left: margin }])
      .png()
      .toBuffer();
    return `data:image/png;base64,${composited.toString('base64')}`;
  } catch (error) {
    console.error('Logo watermark failed, using the unwatermarked image:', error?.message || error);
    return imageDataUrl;
  }
};

const GUEST_TOKEN_RATE_LIMIT_PER_HOUR = Number(process.env.GUEST_TOKEN_RATE_LIMIT_PER_HOUR) || 30;

// Telegram rejects the whole send with "message caption is too long" if a photo/video/
// document caption exceeds 1024 characters (sendMessage's own text has a separate, higher
// 4096 limit) — truncate defensively so a long caption never silently blocks delivery.
export const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_MESSAGE_LIMIT = 4096;
export const truncateForTelegram = (text, limit) => {
  const value = String(text || '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
};

export const escapeTelegramHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const formatTelegramHtml = (value = '') => escapeTelegramHtml(value)
  .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  // Single-marker italic, run after ** is already consumed above -- requires a
  // non-space character on both sides of the marker so things like "5 * 2" or a
  // lone bullet dash never get misread as the start of emphasis.
  .replace(/(?<![*\w])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?!\*)/g, '<i>$1</i>')
  .replace(/(?<![_\w])_([^\s_][^_\n]*?[^\s_]|[^\s_])_(?!_)/g, '<i>$1</i>')
  // Telegram has no <ul>/<li> -- the closest visual equivalent is a plain bullet.
  .replace(/^\s*[-*]\s+/gm, '• ');

// formatTelegramHtml can *expand* text (e.g. a markdown link's `[label](url)`
// becomes the longer `<a href="url">label</a>`), so truncating the raw markdown
// to `limit` first doesn't guarantee the formatted HTML sent to Telegram still
// fits under it. Binary-search the raw cutoff instead so the formatted result
// does. This stays well-formed because formatTelegramHtml only ever emits a tag
// for a *fully matched* markdown construct -- slicing raw text never leaves a
// half-open tag, it just leaves the trailing partial construct unmatched (and
// thus untouched, escaped plain text).
export const telegramTextFor = (text, limit) => {
  const raw = String(text || '');
  const full = formatTelegramHtml(raw);
  if (full.length <= limit) return full;

  let lo = 0;
  let hi = raw.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (formatTelegramHtml(raw.slice(0, mid)).length <= limit - 1) lo = mid;
    else hi = mid - 1;
  }
  return `${formatTelegramHtml(raw.slice(0, lo))}…`;
};

const verifyUser = async (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    const error = new Error('Please sign in before scheduling auto-posts.');
    error.statusCode = 401;
    throw error;
  }
  return admin.auth().verifyIdToken(token, true);
};

const createGuestToken = async (req, res, db) => {
  // No auth exists yet at this point (this endpoint is what *creates* a guest
  // session) -- the client IP is the only available throttling key.
  try {
    const { allowed } = await checkRateLimit(db, {
      scope: 'guest-token',
      key: getClientIp(req),
      limit: GUEST_TOKEN_RATE_LIMIT_PER_HOUR,
    });
    if (!allowed) {
      return res.status(429).json({ ok: false, error: 'Too many guest sessions started from this connection. Please wait a bit and try again.' });
    }
  } catch (error) {
    console.error('Guest-token rate limit check failed, allowing request through:', error?.message || error);
  }

  // The caller must never choose its Firebase UID. A caller-selected installation
  // ID could be reused to mint a token for an existing guest account.
  const uid = `guest_device_${randomBytes(20).toString('hex')}`;
  const token = await admin.auth().createCustomToken(uid, { guest: true });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, token });
};

const createSignedUpload = async (req, res) => {
  const decoded = await verifyUser(req);
  const folder = `/telegram-media/${decoded.uid}`;
  const auth = await createImageKitUploadAuth({ folder, fileName: req.body?.fileName || 'media.mp4', contentType: req.body?.contentType || 'video/mp4' });

  return res.status(200).json({
    ok: true,
    ...auth,
    folder,
  });
};

export const uploadMediaDataUrl = (options) => uploadImageKitMediaDataUrl({
  folder: '/telegram-media',
  ...options,
});

// ImageKit can return 403 "Video transformations limit exceeded" even for a
// plain video URL because its default delivery optimizes video automatically.
// Uploaded MP4s need no processing for Telegram; orig-true serves their bytes
// without spending video transformation quota. Keep substantive transforms
// (such as narration or logo overlays) on generated videos intact.
export const telegramMediaUrlFor = (mediaUrl, mediaType) => {
  const source = String(mediaUrl || '').trim();
  if (mediaType !== 'video' || !isImageKitMediaUrl(source)) {
    return applyImageKitDeliveryTransform(source, mediaType === 'video' ? 'video' : 'photo');
  }
  return getUntransformedImageKitVideoUrl(source, process.env.IMAGEKIT_URL_ENDPOINT || '');
};

const MAX_TELEGRAM_UPLOAD_BYTES = 50 * 1000 * 1000;
const MAX_TELEGRAM_PHOTO_BYTES = 10 * 1000 * 1000;
const isTrustedMediaDownloadUrl = (mediaUrl) => {
  if (isImageKitMediaUrl(mediaUrl)) return true;
  try {
    const url = new URL(mediaUrl);
    return url.protocol === 'https:' && ['firebasestorage.googleapis.com', 'storage.googleapis.com'].includes(url.hostname);
  } catch {
    return false;
  }
};

// Telegram can fetch at most 20 MB from a URL, while multipart video uploads
// may be up to 50 MB. Download only our own storage URLs and upload the bytes
// directly so large videos and long ImageKit filenames can be published.
export const uploadTelegramMediaUrl = async ({ token, chatId, mediaUrl, mediaType, caption }) => {
  if (!isTrustedMediaDownloadUrl(mediaUrl)) throw new Error('The scheduled media URL is not from app storage. Please upload the file again.');
  const isVideo = mediaType === 'video';
  const maxBytes = isVideo ? MAX_TELEGRAM_UPLOAD_BYTES : MAX_TELEGRAM_PHOTO_BYTES;
  const source = await fetch(mediaUrl, { signal: AbortSignal.timeout(120000) });
  if (!source.ok) {
    throw new Error(source.status === 403 && isImageKitMediaUrl(mediaUrl)
      ? 'The stored video is unavailable from ImageKit. Please upload the original file again or restore the ImageKit video allowance.'
      : `The stored media could not be downloaded (HTTP ${source.status}). Please upload the file again.`);
  }
  const declaredSize = Number(source.headers.get('content-length'));
  if (declaredSize > maxBytes) throw new Error(isVideo
    ? 'Telegram accepts video files up to 50 MB. Please choose a smaller file.'
    : 'Telegram accepts photos up to 10 MB. Please choose a smaller image.');
  const bytes = Buffer.from(await source.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error(isVideo
    ? 'The video is empty or exceeds Telegram\'s 50 MB limit.'
    : 'The photo is empty or exceeds Telegram\'s 10 MB limit.');
  const contentType = source.headers.get('content-type') || '';
  if (isVideo && !/^video\//i.test(contentType)) throw new Error('The stored video URL did not return a video file. Please upload the file again.');
  const form = new FormData();
  form.set('chat_id', String(chatId));
  if (caption) {
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
  }
  form.set(isVideo ? 'video' : 'photo', new Blob([bytes], { type: isVideo ? 'video/mp4' : contentType || 'image/jpeg' }), isVideo ? 'telegram-video.mp4' : 'telegram-photo.jpg');
  const response = await fetch(`https://api.telegram.org/bot${token}/${isVideo ? 'sendVideo' : 'sendPhoto'}`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data?.description || 'Telegram could not publish this media file.');
  return { messageId: data.result?.message_id || null };
};

const startPlanVideoJob = async (item, speech) => {
  const requestedDuration = Number(item.duration);
  const duration = [4, 6, 8].includes(requestedDuration) ? requestedDuration : 8;
  // content_plan_items is a client-writable collection (scoped to the owning
  // userId, same as every other field on it) -- a crafted/buggy write could set
  // productImageUrl to an arbitrary URL bypassing the picker UI, which would
  // otherwise be sent straight to the paid OpenRouter provider as a reference
  // image unchecked. Re-verify against the owner's saved gallery, same as the
  // interactive videoGenerate path in api/ai.js.
  let productImageUrl = '';
  const rawProductImageUrl = String(item.productImageUrl || '').trim();
  if (rawProductImageUrl) {
    try {
      const savedProfile = (await initFirebaseAdmin().collection('business_profiles').doc(item.userId).get()).data();
      const savedProductImages = Array.isArray(savedProfile?.productImages) ? savedProfile.productImages : [];
      if (savedProductImages.some((image) => image?.imageUrl === rawProductImageUrl)) productImageUrl = rawProductImageUrl;
    } catch (error) {
      // This path auto-publishes with no human review -- unlike the
      // interactive videoGenerate path, where a person sees the result before
      // it ships, a transient read failure here would otherwise silently
      // downgrade an intentionally product-specific video to a generic one
      // with nobody ever told. Surface it the same way every other
      // unattended failure in this file does.
      console.error('Could not verify selected product image ownership:', error?.message || error);
      await notifyAdmins(`Content plan item for ${item.userId}: could not verify saved product image, publishing without it: ${error?.message || error}`);
    }
  }
  return startKhmerVideoJob(item, speech, uploadMediaDataUrl, {
    duration,
    generateAudio: false,
    allowImageFallback: true,
    allowScriptShortening: item.scriptEditedByUser !== true,
    aspectRatio: item.aspectRatio || '9:16',
    productImageUrl,
  });
};

// AI-generated images commonly come out as multi-megabyte, full-resolution (e.g.
// 2048x2048) PNGs — Telegram's sendPhoto/sendVideo, when given a URL rather than a
// direct file upload, silently refuses large files with the cryptic error "Bad
// Request: wrong type of the web page content" instead of a clear size-limit message
// (confirmed live: a 6.5MB PNG triggered exactly this). ImageKit can resize/
// recompress on the fly by inserting a transformation segment into the delivery URL,
// with no need to re-upload — cap dimensions and let it auto-pick quality/format.
const scheduleQStashDelivery = async (req, postId, scheduledDate) => {
  const token = (process.env.QSTASH_TOKEN || '').trim();
  if (!token) return false;

  try {
    const client = new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
    await client.publishJSON({
      url: `${getScheduledCallbackBaseUrl()}/api/telegram/deliver`,
      body: { postId },
      notBefore: Math.floor(scheduledDate.getTime() / 1000),
    });
    return true;
  } catch (error) {
    // Falls back to the periodic cron/GitHub Action poller, so a QStash
    // hiccup should never block scheduling the post itself -- but that poller
    // has been observed lagging its configured 10-minute schedule by two hours
    // or more, so an admin needs to know right away rather than discover it
    // from a late post.
    const message = error?.message || String(error);
    console.error('QStash scheduling failed:', message);
    await notifyAdmins(`Telegram QStash scheduling failed for post ${postId}, falling back to the periodic poller (can lag hours): ${message}`);
    return false;
  }
};

// Video generation takes minutes and this cron only runs once a day, so a
// video content-plan item can't finish within one cron invocation. Instead,
// QStash re-invokes api/telegram/deliver.js on a short delay to check the job
// again -- and re-schedules itself for another check if it's still running --
// turning a single daily cron tick into an effectively continuous poll for
// however long that one video job takes.
export const scheduleContentPlanPoll = async (req, itemId, delaySeconds = 20) => {
  const token = (process.env.QSTASH_TOKEN || '').trim();
  if (!token) throw new Error('QSTASH_TOKEN is not configured, so video generation cannot be polled to completion.');

  const client = new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
  await client.publishJSON({
    url: `${getScheduledCallbackBaseUrl()}/api/telegram/deliver`,
    body: { contentPlanItemId: itemId },
    delay: delaySeconds,
  });
};

const createScheduledTelegramPost = async (req, res) => {
  const decoded = await verifyUser(req);
  const content = String(req.body?.content || '').trim();
  const scheduledTime = String(req.body?.scheduledTime || '').trim();
  const mediaDataUrl = String(req.body?.mediaDataUrl || '').trim();
  const mediaUrl = String(req.body?.mediaUrl || '').trim();
  const mediaName = String(req.body?.mediaName || '').trim();
  const requestedMediaType = String(req.body?.mediaType || '').trim().toLowerCase();
  const groupId = String(req.body?.groupId || '').trim();
  if (groupId && !/^[A-Za-z0-9_-]{8,100}$/.test(groupId)) {
    return res.status(400).json({ error: 'Invalid schedule group id.' });
  }

  if (!content && !mediaDataUrl && !mediaUrl) {
    return res.status(400).json({ error: 'Text or media is required.' });
  }

  const scheduledDate = new Date(scheduledTime);
  // The client already validated this against its own clock before uploading
  // media and calling this endpoint, which can take a while. Re-checking here
  // with no grace period would reject times that were valid when the user
  // picked them, so allow the same one-minute grace window as the client.
  if (!scheduledTime || Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() - 60000) {
    return res.status(400).json({ error: 'Please choose a future publish time.' });
  }

  const db = initFirebaseAdmin();
  const destination = await resolveTelegramDestination(db, decoded.uid);
  if (!destination.token || !destination.chatId) {
    return res.status(409).json({ error: 'Connect your own Telegram bot and channel in Business Profile before scheduling.' });
  }
  let uploaded;
  if (mediaUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(mediaUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid media URL.' });
    }
    if (!isImageKitMediaUrl(mediaUrl)) {
      return res.status(400).json({ error: 'Only media uploaded to the app storage can be scheduled.' });
    }
    uploaded = {
      mediaUrl,
      mediaType: requestedMediaType === 'video' || requestedMediaType === 'photo'
        ? requestedMediaType
        : /\.(?:mp4|mov|webm)(?:$|\?)/i.test(mediaUrl)
          ? 'video'
          : 'photo'
    };
  } else {
    uploaded = await uploadMediaDataUrl({
      mediaDataUrl,
      fileName: mediaName,
      mediaType: requestedMediaType
    });
  }

  const docRef = await db.collection('scheduled_posts').add({
    content,
    platform: 'TELEGRAM',
    scheduledTime: scheduledDate.toISOString(),
    status: 'PENDING',
    userId: decoded.uid,
    ...(groupId ? { groupId } : {}),
    aiSuggested: false,
    mediaUrl: uploaded.mediaUrl,
    mediaName: mediaName || null,
    mediaType: uploaded.mediaType,
    publishMode: 'TELEGRAM_AUTO_POST',
    createdAt: FieldValue.serverTimestamp()
  });

  await logAudit(db, {
    action: 'scheduled_post_created',
    actorUid: decoded.uid,
    actorLabel: decoded.email || null,
    meta: { postId: docRef.id, platform: 'TELEGRAM', scheduledTime: scheduledDate.toISOString(), hasMedia: true },
  });

  const preciseDeliveryQueued = await scheduleQStashDelivery(req, docRef.id, scheduledDate);

  return res.status(200).json({ ok: true, id: docRef.id, preciseDeliveryQueued });
};

// Immediate (non-scheduled) Telegram send, merged in from the former
// api/telegram/post.js route to stay under Vercel Hobby's 12-function limit.
// Unlike sendTelegram() above (used for scheduled posts, which only ever hold
// an ImageKit mediaUrl), this also accepts a raw mediaDataUrl upload.
export const postTelegramMessage = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let decoded;
  try {
    decoded = await verifyUser(req);
  } catch {
    return res.status(401).json({ error: 'Sign in to send to your Telegram channel.' });
  }
  const db = initFirebaseAdmin();
  const { token, chatId } = await resolveTelegramDestination(db, decoded.uid);

  if (!token || !chatId) {
    return res.status(503).json({
      error: 'Connect your own Telegram bot and channel in Business Profile before publishing.'
    });
  }

  const rawText = String(req.body?.text || '').trim();
  const mediaDataUrl = String(req.body?.mediaDataUrl || '').trim();
  const mediaName = String(req.body?.mediaName || 'telegram-media').trim();
  const mediaType = String(req.body?.mediaType || '').trim().toLowerCase();
  // Use original bytes for uploaded videos, and resize images for URL delivery.
  // The video branch below sends multipart so Telegram's 20 MB URL limit does
  // not block ordinary user uploads.
  const mediaUrl = telegramMediaUrlFor(req.body?.mediaUrl, mediaType);

  if (!rawText && !mediaUrl && !mediaDataUrl) {
    return res.status(400).json({ error: 'Telegram text, image, or video is required.' });
  }

  try {
    const hasMedia = !!(mediaUrl || mediaDataUrl);
    const text = telegramTextFor(rawText, hasMedia ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_MESSAGE_LIMIT);
    if (mediaUrl && !mediaDataUrl && mediaType === 'video') {
      const { messageId } = await uploadTelegramMediaUrl({ token, chatId, mediaUrl, mediaType, caption: text });
      return res.status(200).json({ ok: true, messageId });
    }
    const method = hasMedia
      ? mediaType === 'video'
        ? 'sendVideo'
        : 'sendPhoto'
      : 'sendMessage';

    let payload;
    let headers = { 'Content-Type': 'application/json' };

    if (mediaDataUrl) {
      const match = mediaDataUrl.match(/^data:([^;,]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid media data.' });
      }

      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const form = new FormData();
      form.append('chat_id', chatId);
      if (text) {
        form.append('caption', text);
        form.append('parse_mode', 'HTML');
      }
      form.append(mediaType === 'video' ? 'video' : 'photo', new Blob([buffer], { type: contentType }), mediaName);
      payload = form;
      headers = undefined;
    } else {
      payload = mediaUrl
        ? {
            chat_id: chatId,
            [mediaType === 'video' ? 'video' : 'photo']: mediaUrl,
            caption: text || undefined,
            parse_mode: text ? 'HTML' : undefined
          }
        : {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: false
          };
    }

    let telegramRes = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers,
      body: mediaDataUrl ? payload : JSON.stringify(payload)
    });

    const readTelegramJson = async (response) => {
      const responseText = await response.text();
      try {
        return responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(`Telegram returned HTTP ${response.status} instead of JSON.`);
      }
    };

    let data = await readTelegramJson(telegramRes);

    if (mediaUrl && (!telegramRes.ok || !data.ok)) {
      const uploaded = await uploadTelegramMediaUrl({ token, chatId, mediaUrl, mediaType, caption: text });
      return res.status(200).json({ ok: true, messageId: uploaded.messageId });
    }

    if (!telegramRes.ok || !data.ok) {
      return res.status(502).json({
        error: data?.description || 'Telegram could not publish this message.'
      });
    }

    return res.status(200).json({
      ok: true,
      messageId: data.result?.message_id || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Telegram publish failed.'
    });
  }
};

// Every post requires its owner's Business Profile bot and channel. There is no
// deployment-wide fallback: an ownerless legacy post is never broadcast.
export const resolveTelegramDestination = async (db, userId) => {
  if (!userId || !db) return { token: '', chatId: '' };
  try {
    const snap = await db.collection('business_profiles').doc(userId).get();
    return telegramDestinationFromProfile(snap.data());
  } catch (error) {
    console.error('Could not load the post owner\'s Telegram profile:', error?.message);
    return { token: '', chatId: '' };
  }
};

export const sendTelegram = async (post, db) => {
  const { token, chatId } = await resolveTelegramDestination(db, post.userId);

  if (!token || !chatId) {
    throw new Error('Connect your own Telegram bot and channel in Business Profile before publishing.');
  }

  const rawText = String(post.content || '').trim();
  const mediaType = String(post.mediaType || '').trim().toLowerCase();
  // Uploaded videos use original bytes to avoid ImageKit's transformation quota;
  // generated videos retain any substantive narration or logo transforms.
  const mediaUrl = telegramMediaUrlFor(post.mediaUrl, mediaType);

  if (!rawText && !mediaUrl) {
    throw new Error('Post has no text or media URL.');
  }

  const text = telegramTextFor(rawText, mediaUrl ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_MESSAGE_LIMIT);

  if (mediaUrl) {
    // Use multipart for photos as well as videos. Telegram's URL fetch limit
    // for photos is lower, and fetching through our trusted storage avoids a
    // scheduled photo failing because Telegram could not reach its URL.
    const { messageId } = await uploadTelegramMediaUrl({ token, chatId, mediaUrl, mediaType, caption: text });
    return { messageId, chatId };
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data?.description || 'Telegram could not publish this message.');
  }

  // chatId is returned alongside the message id (not just logged) so callers can
  // persist which chat a delivery actually landed in for diagnostics.
  return { messageId: data.result?.message_id || null, chatId };
};

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'POST' && req.query?.action === 'guest-token') {
    try {
      const db = initFirebaseAdmin();
      return await createGuestToken(req, res, db);
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        ok: false,
        error: error?.message || 'Could not start a guest session.'
      });
    }
  }

  if (req.method === 'POST' && req.query?.action === 'migrate-guest') {
    return res.status(410).json({ ok: false, error: 'Guest migration is no longer available. Refresh the app to continue with your existing session.' });
  }

  if (req.method === 'POST' && req.query?.action === 'create') {
    try {
      initFirebaseAdmin();
      return await createScheduledTelegramPost(req, res);
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        ok: false,
        error: error?.message || 'Could not schedule this Telegram post.'
      });
    }
  }

  if (req.method === 'POST' && req.query?.action === 'sign-upload') {
    try {
      initFirebaseAdmin();
      return await createSignedUpload(req, res);
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        ok: false,
        error: error?.message || 'Could not prepare the media upload.'
      });
    }
  }

  if (req.method === 'POST' && req.query?.action === 'review-video') {
    return reviewVideoHandler(req, res);
  }

  if (req.method === 'POST' && req.query?.action === 'post') {
    return await postTelegramMessage(req, res);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured; refusing to run the scheduled Telegram poller.');
    return res.status(500).json({ error: 'CRON_SECRET is not configured on the server.' });
  }
  const auth = req.headers.authorization || '';
  const querySecret = req.query?.secret;
  if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Proactive OpenRouter/ImageKit quota check, run on its own low-frequency
  // schedule (see .github/workflows/telegram-scheduler.yml) rather than on
  // every 10-minute cron tick, since it calls two external billing APIs.
  if (req.query?.action === 'usageCheck') {
    try {
      const { warnings } = await runUsageChecks();
      return res.status(200).json({ ok: true, warnings });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || 'Usage check failed.' });
    }
  }

  try {
    const db = initFirebaseAdmin();
    const nowIso = new Date().toISOString();

    // Authenticated one-item trigger for an explicitly approved plan video.
    // It returns before the normal cron loops, so no other due content runs.
    const requestedPlanVideoId = String(req.query?.planVideoId || '').trim();
    if (requestedPlanVideoId) {
      if (!/^[A-Za-z0-9_-]{10,128}$/.test(requestedPlanVideoId)) {
        return res.status(400).json({ ok: false, error: 'Invalid content plan video id.' });
      }
      const planRef = db.collection('content_plan_items').doc(requestedPlanVideoId);
      const claim = await claimPendingPost(db, planRef);
      if (!claim.post) {
        return res.status(409).json({ ok: false, error: 'This content plan video is not pending.' });
      }
      const item = claim.post;
      if (item.type !== 'video') {
        await planRef.update({ status: 'PENDING', processingAt: null });
        return res.status(400).json({ ok: false, error: 'The selected content plan item is not a video.' });
      }
      try {
        const profileSnap = await db.collection('business_profiles').doc(item.userId).get().catch(() => null);
        item.businessName = String(item.businessName || profileSnap?.data()?.businessName || '').trim();
        const speech = await preparePlanVideoSpeech(item);
        const { job, avatarImage, narrationAudio: generatedNarrationAudio, imageFallbackReason } = await startPlanVideoJob(item, speech);
        const stillActive = await updateActivePlanItem(db, planRef, {
          status: 'PROCESSING', videoJobId: job.jobId,
          voiceOverText: generatedNarrationAudio?.spokenText || speech.script, voiceOverMode: speech.mode,
          generationPrompt: speech.prompt, performanceStyle: speech.performanceStyle || '',
          ...(avatarImage ? { avatarImage } : {}),
          ...(generatedNarrationAudio ? { narrationAudio: generatedNarrationAudio } : {}),
          imageFallbackReason: imageFallbackReason || null,
          pollAttempts: 0, processingAt: FieldValue.serverTimestamp(),
        });
        if (!stillActive) return res.status(200).json({ ok: true, id: requestedPlanVideoId, skipped: 'superseded' });
        let pollingDeferred = false;
        try {
          await scheduleContentPlanPoll(req, requestedPlanVideoId);
          await planRef.update({ pollScheduledAt: FieldValue.serverTimestamp(), pollSchedulingError: null });
        } catch (scheduleError) {
          pollingDeferred = true;
          const scheduleMessage = scheduleError?.message || 'Could not schedule video polling.';
          await planRef.update({ pollSchedulingError: scheduleMessage, pollSchedulingFailedAt: FieldValue.serverTimestamp() });
          await notifyAdmins(`Video ${job.jobId} started, but polling was deferred and will be recovered by cron: ${scheduleMessage}`);
        }
        return res.status(200).json({ ok: true, id: requestedPlanVideoId, videoStarted: true, jobId: job.jobId, pollingDeferred });
      } catch (error) {
        const message = error?.message || 'Could not start video generation.';
        if (!(await updateActivePlanItem(db, planRef, { status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp() }))) {
          return res.status(200).json({ ok: true, id: requestedPlanVideoId, skipped: 'superseded' });
        }
        await notifyAdmins(`Content plan video item ${requestedPlanVideoId} failed to start manually: ${message}`);
        return res.status(500).json({ ok: false, id: requestedPlanVideoId, error: message });
      }
    }

    // Recover posts that got claimed (PROCESSING) but never finished — e.g. the
    // function timed out or crashed mid-send between the atomic claim and the
    // PUBLISHED/FAILED update. Once claimed, a post is no longer PENDING, so
    // neither this poller's normal query nor a QStash retry would ever touch
    // it again, leaving it stuck forever without this recovery step.
    const STALE_PROCESSING_MS = 3 * 60 * 1000;
    const staleCutoff = Date.now() - STALE_PROCESSING_MS;
    const stuckSnapshot = await db
      .collection('scheduled_posts')
      .where('platform', '==', 'TELEGRAM')
      .where('status', '==', 'PROCESSING')
      .get();
    await Promise.all(stuckSnapshot.docs.map(async (stuckDoc) => {
      const processingAtMs = stuckDoc.data()?.processingAt?.toMillis?.();
      if (typeof processingAtMs !== 'number' || processingAtMs >= staleCutoff) return;

      // Re-check inside a transaction immediately before resetting: the send that
      // originally claimed this post can complete (-> PUBLISHED/FAILED) in the gap
      // between the snapshot read above and this write. An unconditional update
      // would clobber that outcome back to PENDING and send the post a second
      // time — exactly the duplicate-post race the atomic claim elsewhere in this
      // file exists to prevent. Only reset if it's still PROCESSING with the same
      // processingAt we observed (i.e. no newer attempt has claimed it since).
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(stuckDoc.ref);
        const freshData = freshSnap.data();
        const freshProcessingAtMs = freshData?.processingAt?.toMillis?.();
        if (freshData?.status === 'PROCESSING' && freshProcessingAtMs === processingAtMs) {
          tx.update(stuckDoc.ref, { status: 'PENDING' });
        }
      });
    }));

    const results = [];
    const DAILY_IMAGE_CAP = 2;
    const DAILY_VIDEO_CAP = 1;
    const todayStr = new Date().toISOString().slice(0, 10);
    const countGeneratedToday = async (type, statuses) => {
      const snapshot = await db.collection('content_plan_items').where('type', '==', type).where('status', 'in', statuses).get();
      return snapshot.docs.filter((doc) => {
        const data = doc.data();
        const ts = data.completedAt || data.processingAt;
        return ts?.toDate?.().toISOString().slice(0, 10) === todayStr;
      }).length;
    };
    // Start due video before unrelated post or image delivery. Those jobs can
    // fail or consume this invocation's time without affecting video starts.
    try {
      await startDuePlanVideos();
    } catch (error) {
      const message = error?.message || 'Could not check due Content Plan videos.';
      results.push({ id: 'content-plan-videos', ok: false, contentPlan: true, error: message });
      await notifyAdmins(`Content Plan video check failed: ${message}`);
    }

    // Re-arm paid video jobs whose QStash chain was interrupted. Never reset
    // these to PENDING: that would submit a second paid generation and orphan
    // the first. Successful poll scheduling refreshes pollScheduledAt, so the
    // frequent fallback cron only touches jobs with no active chain.
    const videoPollRecoveryCutoff = Date.now() - 90 * 1000;
    const processingVideoSnapshot = await db
      .collection('content_plan_items')
      .where('status', '==', 'PROCESSING')
      .where('type', '==', 'video')
      // Firestore can't express "pollScheduledAt OR processingAt is stale" as
      // a single indexed clause, so staleness is still filtered in memory below
      // -- but an unbounded read here would scale with the whole PROCESSING
      // backlog (worst case during an outage, exactly when it's most expensive).
      // 200 is far above any normal backlog while still bounding that worst case.
      .limit(200)
      .get();
    // A start can time out after its atomic claim but before a provider job ID
    // is saved. Poll recovery cannot help without that ID. Surface the failure
    // instead of leaving the plan indefinitely PROCESSING; never resubmit it
    // automatically because the provider may already have accepted payment.
    for (const stalledDoc of processingVideoSnapshot.docs.filter((doc) => isStalledContentPlanVideoStart(doc.data()))) {
      const message = 'Video start was interrupted before a job ID was saved. It was not retried automatically to avoid a duplicate charge.';
      await stalledDoc.ref.update({ status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp() });
      results.push({ id: stalledDoc.id, ok: false, contentPlan: true, startInterrupted: true, error: message });
      await notifyAdmins(`Content plan video item ${stalledDoc.id}: ${message}`);
    }
    const staleProcessingVideos = processingVideoSnapshot.docs
      .filter((doc) => {
        const video = doc.data();
        const lastScheduledMs = video?.pollScheduledAt?.toMillis?.()
          || video?.processingAt?.toMillis?.()
          || 0;
        return Boolean(video?.videoJobId) && lastScheduledMs < videoPollRecoveryCutoff;
      })
      .slice(0, 10);
    for (const processingDoc of staleProcessingVideos) {
      try {
        await scheduleContentPlanPoll(req, processingDoc.id);
        await processingDoc.ref.update({
          pollScheduledAt: FieldValue.serverTimestamp(),
          pollSchedulingError: null,
          pollRecoveredAt: FieldValue.serverTimestamp(),
        });
        results.push({ id: processingDoc.id, ok: true, contentPlan: true, pollRecovered: true });
      } catch (recoveryError) {
        const message = recoveryError?.message || 'Could not recover video polling.';
        await processingDoc.ref.update({ pollSchedulingError: message, pollSchedulingFailedAt: FieldValue.serverTimestamp() });
        results.push({ id: processingDoc.id, ok: false, contentPlan: true, pollRecoveryFailed: true, error: message });
      }
    }

    // Older narrated videos may already be waiting in REVIEW from the former
    // manual-approval flow. Move every successfully verified one into the same
    // deterministic scheduled-post outbox used by manual approval, so enabling
    // auto-post also drains that backlog without generating or sending twice.
    const verifiedReviewSnapshot = await db
      .collection('content_plan_items')
      .where('status', '==', 'REVIEW')
      .where('type', '==', 'video')
      // See the same note on processingVideoSnapshot above -- bounded well
      // above any normal REVIEW backlog, just not unbounded.
      .limit(200)
      .get();
    const verifiedReviewDocs = verifiedReviewSnapshot.docs
      .filter((doc) => doc.data()?.speechVerification?.passed === true && doc.data()?.resultMediaUrl && !doc.data()?.imageFallbackReason)
      .slice(0, 10);
    for (const reviewDoc of verifiedReviewDocs) {
      let queued = false;
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(reviewDoc.ref);
        const item = freshSnap.data();
        if (item?.status !== 'REVIEW' || item?.type !== 'video' || item?.speechVerification?.passed !== true || !item?.resultMediaUrl || item?.imageFallbackReason) return;

        const outboxRef = db.collection('scheduled_posts').doc(`review-${reviewDoc.id}`);
        tx.set(outboxRef, {
          userId: item.userId,
          content: item.topic || '',
          platform: 'TELEGRAM',
          mediaUrl: item.resultMediaUrl,
          mediaType: 'video',
          status: 'PENDING',
          scheduledTime: nowIso,
          publishMode: 'TELEGRAM_AUTO_POST',
          createdAt: FieldValue.serverTimestamp(),
          aiSuggested: false,
        });
        tx.update(reviewDoc.ref, {
          status: 'DONE',
          completedAt: FieldValue.serverTimestamp(),
          autoApproved: true,
          approvedPostId: outboxRef.id,
        });
        queued = true;
      });
      if (queued) results.push({ id: reviewDoc.id, ok: true, contentPlan: true, legacyVideoQueued: true });
    }

    const snapshot = await db
      .collection('scheduled_posts')
      .where('platform', '==', 'TELEGRAM')
      .where('status', '==', 'PENDING')
      .where('scheduledTime', '<=', nowIso)
      .orderBy('scheduledTime', 'asc')
      .limit(25)
      .get();

    const dueDocs = snapshot.docs
      .slice(0, 10);

    for (const doc of dueDocs) {
      const claim = await claimPendingPost(db, doc.ref);

      if (!claim.post) {
        results.push({ id: doc.id, ok: true, skipped: true });
        continue;
      }

      const post = claim.post;

      const duplicateId = await findRecentDuplicateTelegramPost(db, post);
      if (duplicateId) {
        await doc.ref.update({
          status: 'PUBLISHED',
          telegramMessageId: null,
          publishedAt: FieldValue.serverTimestamp(),
          duplicateSkipped: true,
          errorMessage: `Skipped -- duplicate of already-published post ${duplicateId}`
        });
        results.push({ id: doc.id, ok: true, skippedDuplicate: duplicateId });
        continue;
      }

      try {
        const { messageId, chatId } = await sendTelegram(post, db);

        await doc.ref.update({
          status: 'PUBLISHED',
          telegramMessageId: messageId,
          deliveredChatId: chatId,
          publishedAt: FieldValue.serverTimestamp(),
          errorMessage: null
        });

        results.push({ id: doc.id, ok: true, messageId });
      } catch (error) {
        const message = error?.message || 'Telegram publish failed.';
        await doc.ref.update({
          status: 'FAILED',
          errorMessage: message,
          failedAt: FieldValue.serverTimestamp()
        });
        results.push({ id: doc.id, ok: false, error: message });
        await notifyAdmins(`Telegram post ${doc.id} failed (cron): ${message}`);
      }
    }

    // Auto-generate content-plan items (see extractContentPlan in api/ai.js
    // and AIAgent.tsx's plan-upload UI) due today or earlier.
    //
    // The cap must reflect how many have ALREADY been generated today across
    // every invocation, not just this one -- capping only per-invocation
    // (the original version of this) let each extra trigger on the same day
    // (a manual re-run, a duplicate cron fire) add its own fresh 2/1 on top,
    // and that's exactly what happened live: one day produced 8 images and 3
    // videos instead of 2 and 1. countGeneratedToday makes the cap a real
    // per-calendar-day ceiling no matter how many times this runs today.
    const imagesGeneratedToday = await countGeneratedToday('image', ['DONE']);
    const remainingImageCap = Math.max(0, DAILY_IMAGE_CAP - imagesGeneratedToday);
    const planSnapshot = await db
      .collection('content_plan_items')
      .where('status', '==', 'PENDING')
      .where('type', '==', 'image')
      .where('scheduledDate', '<=', todayStr)
      .orderBy('scheduledDate', 'asc')
      .limit(20)
      .get();
    const duePlanItems = planSnapshot.docs
      .slice(0, remainingImageCap);

    for (const planDoc of duePlanItems) {
      // Same atomic compare-and-swap claimPendingPost already uses for
      // scheduled_posts -- without it, two overlapping cron runs (a slow
      // prior invocation plus a fresh scheduled trigger, or a manual
      // re-trigger) can both read this doc as PENDING and both generate +
      // send the same image.
      const claim = await claimPendingPost(db, planDoc.ref);
      if (!claim.post) {
        results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: true });
        continue;
      }
      const item = claim.post;
      try {
        const image = await generateOpenRouterImage({ prompt: item.prompt, aspectRatio: item.aspectRatio || '1:1' });
        const profileSnap = await db.collection('business_profiles').doc(item.userId).get().catch(() => null);
        const postered = await applyPosterTextOverlay(image.imageUrl, item.headline || '', item.cta || '');
        const watermarked = await applyLogoWatermarkServer(postered, profileSnap?.data()?.logoDataUrl);
        const uploaded = await uploadMediaDataUrl({ mediaDataUrl: watermarked, mediaType: 'photo' });
        // Persist the durable ImageKit URL as soon as the (paid) image exists, before
        // the Telegram send that follows can fail -- otherwise a transient delivery
        // failure (rate limit, timeout, missing bot config) hits the catch below and
        // discards an already-generated image, forcing a costly full regeneration on retry.
        if (!(await updateActivePlanItem(db, planDoc.ref, { resultMediaUrl: uploaded.mediaUrl }))) {
          results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: 'superseded' });
          continue;
        }

        const fanout = await queueContentPlanDestinations(db, planDoc.id, uploaded.mediaUrl, req);
        if (fanout.skipped === 'inactive') {
          results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: 'superseded' });
          continue;
        }
        if (Array.isArray(fanout.skipped) && (fanout.queued.length || fanout.skipped.length)) {
          await updateActivePlanItem(db, planDoc.ref, { publishDestinationsQueued: fanout.queued, publishDestinationsSkipped: fanout.skipped });
        }

        const { token, chatId } = await resolveTelegramDestination(db, item.userId);
        if (!token || !chatId) {
          throw new Error('No Telegram bot/channel is connected to deliver this to. Connect one in Business Profile.');
        }

        const beforeSend = await planDoc.ref.get();
        if (beforeSend.data()?.status !== 'PROCESSING' || beforeSend.data()?.supersededBy) {
          results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: 'superseded' });
          continue;
        }

        const caption = telegramTextFor(item.topic || '', TELEGRAM_CAPTION_LIMIT);
        const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            photo: uploaded.mediaUrl,
            caption: caption || undefined,
            parse_mode: caption ? 'HTML' : undefined,
          }),
        });
        const telegramData = await telegramResponse.json().catch(() => ({}));
        if (!telegramResponse.ok || !telegramData.ok) {
          throw new Error(telegramData?.description || 'Telegram could not deliver this image.');
        }

        await updateActivePlanItem(db, planDoc.ref, {
          status: 'DONE',
          resultMediaUrl: uploaded.mediaUrl,
          deliveredChatId: chatId,
          completedAt: FieldValue.serverTimestamp(),
          errorMessage: null,
        });
        results.push({ id: planDoc.id, ok: true, contentPlan: true });
      } catch (error) {
        const message = error?.message || 'Content plan generation failed.';
        if (!(await updateActivePlanItem(db, planDoc.ref, { status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp() }))) {
          results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: 'superseded' });
          continue;
        }
        results.push({ id: planDoc.id, ok: false, contentPlan: true, error: message });
        await notifyAdmins(`Content plan item ${planDoc.id} failed (cron): ${message}`);
      }
    }

    async function startDuePlanVideos() {
    // Video items: start the job here, then hand off to QStash (see
    // scheduleContentPlanPoll / api/telegram/deliver.js) to poll it to
    // completion -- a video job routinely takes minutes, far longer than this
    // once-a-day cron invocation should block on, so the actual wait happens
    // across separate short-lived QStash-triggered function calls instead.
    // PROCESSING and REVIEW count too, not just DONE -- a video started earlier
    // today already consumed today's quota while it is being generated or waits
    // for the required human quality check.
    const videosGeneratedToday = await countGeneratedToday('video', GENERATED_VIDEO_STATUSES);
    const remainingVideoCap = Math.max(0, DAILY_VIDEO_CAP - videosGeneratedToday);
    const videoPlanSnapshot = await db
      .collection('content_plan_items')
      .where('status', '==', 'PENDING')
      .where('type', '==', 'video')
      .where('scheduledDate', '<=', todayStr)
      .orderBy('scheduledDate', 'asc')
      .limit(10)
      .get();
    const dueVideoPlanItems = videoPlanSnapshot.docs
      .slice(0, remainingVideoCap);

    for (const planDoc of dueVideoPlanItems) {
      // Same atomic claim as the image loop above -- without it, two
      // overlapping cron runs could both start a paid video generation job
      // for the same item (the second one's videoJobId would silently
      // clobber the first's, orphaning that job and its cost).
      const claim = await claimPendingPost(db, planDoc.ref);
      if (!claim.post) {
        results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: true });
        continue;
      }
      const item = claim.post;
      try {
        const profileSnap = await db.collection('business_profiles').doc(item.userId).get().catch(() => null);
        item.businessName = String(item.businessName || profileSnap?.data()?.businessName || '').trim();
        const speech = await preparePlanVideoSpeech(item);
        const { job, avatarImage, narrationAudio: generatedNarrationAudio, imageFallbackReason } = await startPlanVideoJob(item, speech);
        const stillActive = await updateActivePlanItem(db, planDoc.ref, {
          status: 'PROCESSING',
          videoJobId: job.jobId,
          voiceOverText: generatedNarrationAudio?.spokenText || speech.script,
          voiceOverMode: speech.mode,
          generationPrompt: speech.prompt,
          performanceStyle: speech.performanceStyle || '',
          ...(avatarImage ? { avatarImage } : {}),
          ...(generatedNarrationAudio ? { narrationAudio: generatedNarrationAudio } : {}),
          imageFallbackReason: imageFallbackReason || null,
          pollAttempts: 0,
          processingAt: FieldValue.serverTimestamp(),
        });
        if (!stillActive) {
          results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: 'superseded' });
          continue;
        }
        let pollingDeferred = false;
        try {
          await scheduleContentPlanPoll(req, planDoc.id);
          await planDoc.ref.update({ pollScheduledAt: FieldValue.serverTimestamp(), pollSchedulingError: null });
        } catch (scheduleError) {
          pollingDeferred = true;
          const scheduleMessage = scheduleError?.message || 'Could not schedule video polling.';
          await planDoc.ref.update({ pollSchedulingError: scheduleMessage, pollSchedulingFailedAt: FieldValue.serverTimestamp() });
          await notifyAdmins(`Video ${job.jobId} started, but polling was deferred and will be recovered by cron: ${scheduleMessage}`);
        }
        results.push({ id: planDoc.id, ok: true, contentPlan: true, videoStarted: true, pollingDeferred });
      } catch (error) {
        const message = error?.message || 'Could not start video generation.';
        if (!(await updateActivePlanItem(db, planDoc.ref, { status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp() }))) {
          results.push({ id: planDoc.id, ok: true, contentPlan: true, skipped: 'superseded' });
          continue;
        }
        results.push({ id: planDoc.id, ok: false, contentPlan: true, error: message });
        await notifyAdmins(`Content plan video item ${planDoc.id} failed to start (cron): ${message}`);
      }
    }
    }

    if (results.length > 0) {
      await logAudit(db, {
        action: 'telegram_cron_run',
        actorLabel: 'cron',
        meta: {
          processed: results.length,
          failed: results.filter((r) => !r.ok).length
        }
      });
    }

    return res.status(200).json({
      ok: true,
      checkedAt: nowIso,
      processed: results.length,
      results
    });
  } catch (error) {
    const message = error?.message || 'Scheduled Telegram runner failed.';
    await notifyAdmins(`Telegram cron runner crashed: ${message}`);
    return res.status(500).json({
      ok: false,
      error: message
    });
  }
}
