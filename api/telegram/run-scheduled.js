import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { Client as QStashClient } from '@upstash/qstash';
import { logAudit } from '../_audit.js';
import { claimPendingPost, findRecentDuplicateTelegramPost } from '../_telegramClaim.js';
import { notifyAdmins } from '../_alert.js';
import { checkRateLimit, getClientIp } from '../_rateLimit.js';

const GUEST_TOKEN_RATE_LIMIT_PER_HOUR = Number(process.env.GUEST_TOKEN_RATE_LIMIT_PER_HOUR) || 30;

// Telegram rejects the whole send with "message caption is too long" if a photo/video/
// document caption exceeds 1024 characters (sendMessage's own text has a separate, higher
// 4096 limit) — truncate defensively so a long caption never silently blocks delivery.
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_MESSAGE_LIMIT = 4096;
export const truncateForTelegram = (text, limit) => {
  const value = String(text || '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
};

const escapeTelegramHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const formatTelegramHtml = (value = '') => escapeTelegramHtml(value)
  .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

const telegramTextFor = (text, limit) => formatTelegramHtml(truncateForTelegram(text, limit));

export const initFirebaseAdmin = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured.');
  }

  if (admin.apps.length) {
    const app = admin.app();
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }

  let app;
  if (clientEmail && privateKey) {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId
    });
  } else {
    app = admin.initializeApp({ projectId });
  }

  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
};

const getCloudinaryConfig = () => {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).');
  }
  return { cloudName, apiKey, apiSecret };
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

const USER_DATA_COLLECTIONS = [
  'scheduled_posts',
  'audience_activity',
  'campaigns',
  'reply_rules'
];

const getStableGuestUid = (installationId) => {
  const normalizedId = String(installationId || '').trim();
  if (!normalizedId || normalizedId.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(normalizedId)) {
    const error = new Error('A valid guest installation ID is required.');
    error.statusCode = 400;
    throw error;
  }

  const digest = createHash('sha256')
    .update(`aime.angkorgate:${normalizedId}`)
    .digest('hex')
    .slice(0, 40);
  return `guest_device_${digest}`;
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

  const uid = getStableGuestUid(req.body?.installationId);
  const token = await admin.auth().createCustomToken(uid, { guest: true });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, token });
};

const migrateGuestData = async (req, res) => {
  const decoded = await verifyUser(req);
  if (decoded.guest !== true) {
    return res.status(403).json({ error: 'Only guest sessions can be migrated.' });
  }

  const targetUid = getStableGuestUid(req.body?.installationId);
  const db = initFirebaseAdmin();
  const migrated = {};

  if (decoded.uid !== targetUid) {
    for (const collectionName of USER_DATA_COLLECTIONS) {
      let migratedCount = 0;

      while (true) {
        const snapshot = await db
          .collection(collectionName)
          .where('userId', '==', decoded.uid)
          .limit(400)
          .get();

        if (snapshot.empty) break;

        const batch = db.batch();
        snapshot.docs.forEach((document) => {
          batch.update(document.ref, { userId: targetUid });
        });
        await batch.commit();
        migratedCount += snapshot.size;
      }

      migrated[collectionName] = migratedCount;
    }
  }

  const token = await admin.auth().createCustomToken(targetUid, { guest: true });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, token, migrated });
};

const createSignedUpload = async (req, res) => {
  const decoded = await verifyUser(req);
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `telegram-media/${decoded.uid}`;
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(paramsToSign + apiSecret).digest('hex');

  return res.status(200).json({
    ok: true,
    apiKey,
    timestamp,
    signature,
    folder,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    maxBytes: 48 * 1024 * 1024
  });
};

const uploadMediaDataUrl = async ({ mediaDataUrl, mediaType }) => {
  if (!mediaDataUrl) return { mediaUrl: '', mediaType: null };

  const match = String(mediaDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid media file data.');
  }

  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = 48 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error('This media file is too large for web scheduling. Please use a file under 48 MB.');
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=telegram-media&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(paramsToSign + apiSecret).digest('hex');

  const form = new URLSearchParams();
  form.set('file', mediaDataUrl);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('signature', signature);
  form.set('folder', 'telegram-media');

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Cloudinary upload failed.');
  }

  const resolvedMediaType = mediaType || (data.resource_type === 'video' ? 'video' : contentType.startsWith('video/') ? 'video' : 'photo');

  return {
    mediaUrl: applyCloudinaryDeliveryTransform(data.secure_url, resolvedMediaType),
    mediaType: resolvedMediaType
  };
};

// AI-generated images commonly come out as multi-megabyte, full-resolution (e.g.
// 2048x2048) PNGs — Telegram's sendPhoto/sendVideo, when given a URL rather than a
// direct file upload, silently refuses large files with the cryptic error "Bad
// Request: wrong type of the web page content" instead of a clear size-limit message
// (confirmed live: a 6.5MB PNG triggered exactly this). Cloudinary can resize/
// recompress on the fly by inserting a transformation segment into the delivery URL,
// with no need to re-upload — cap dimensions and let it auto-pick quality/format.
export const applyCloudinaryDeliveryTransform = (secureUrl, mediaType) => {
  const transform = mediaType === 'video' ? 'q_auto,w_1280' : 'w_1280,q_auto,f_auto';
  const marker = mediaType === 'video' ? '/video/upload/' : '/image/upload/';
  const index = secureUrl.indexOf(marker);
  if (index === -1) return secureUrl;
  const insertAt = index + marker.length;
  const rest = secureUrl.slice(insertAt);
  // Safe to call unconditionally on every outgoing send (some mediaUrls already
  // carry this transform from upload time, others -- e.g. a URL scheduled
  // directly, or the legacy immediate-send path -- never got it applied at all).
  // Skip re-inserting so a URL already carrying the transform isn't doubled up.
  if (rest.startsWith(transform)) return secureUrl;
  return `${secureUrl.slice(0, insertAt)}${transform}/${rest}`;
};

const scheduleQStashDelivery = async (req, postId, scheduledDate) => {
  const token = (process.env.QSTASH_TOKEN || '').trim();
  if (!token) return;

  try {
    const client = new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    await client.publishJSON({
      url: `https://${host}/api/telegram/deliver`,
      body: { postId },
      notBefore: Math.floor(scheduledDate.getTime() / 1000),
    });
  } catch (error) {
    // Falls back to the periodic cron/GitHub Action poller, so a QStash
    // hiccup should never block scheduling the post itself.
    console.error('QStash scheduling failed:', error?.message || error);
  }
};

const createScheduledTelegramPost = async (req, res) => {
  const decoded = await verifyUser(req);
  const content = String(req.body?.content || '').trim();
  const scheduledTime = String(req.body?.scheduledTime || '').trim();
  const mediaDataUrl = String(req.body?.mediaDataUrl || '').trim();
  const mediaUrl = String(req.body?.mediaUrl || '').trim();
  const mediaName = String(req.body?.mediaName || '').trim();
  const requestedMediaType = String(req.body?.mediaType || '').trim().toLowerCase();

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
  let uploaded;
  if (mediaUrl) {
    const { cloudName } = getCloudinaryConfig();
    let parsedUrl;
    try {
      parsedUrl = new URL(mediaUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid media URL.' });
    }
    const expectedPathPrefix = `/${cloudName}/`;
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'res.cloudinary.com' || !parsedUrl.pathname.startsWith(expectedPathPrefix)) {
      return res.status(400).json({ error: 'Only media uploaded to the app storage can be scheduled.' });
    }
    uploaded = {
      mediaUrl,
      mediaType: requestedMediaType === 'video' || requestedMediaType === 'photo'
        ? requestedMediaType
        : parsedUrl.pathname.includes('/video/upload/')
          ? 'video'
          : 'photo'
    };
  } else {
    uploaded = await uploadMediaDataUrl({
      userId: decoded.uid,
      mediaDataUrl,
      mediaName,
      mediaType: requestedMediaType
    });
  }

  const docRef = await db.collection('scheduled_posts').add({
    content,
    platform: 'TELEGRAM',
    scheduledTime: scheduledDate.toISOString(),
    status: 'PENDING',
    userId: decoded.uid,
    aiSuggested: false,
    mediaUrl: uploaded.mediaUrl,
    mediaName: mediaName || null,
    mediaType: uploaded.mediaType,
    publishMode: 'TELEGRAM_AUTO_POST',
    createdAt: FieldValue.serverTimestamp()
  });

  await scheduleQStashDelivery(req, docRef.id, scheduledDate);

  return res.status(200).json({ ok: true, id: docRef.id });
};

// Immediate (non-scheduled) Telegram send, merged in from the former
// api/telegram/post.js route to stay under Vercel Hobby's 12-function limit.
// Unlike sendTelegram() above (used for scheduled posts, which only ever hold
// a Cloudinary mediaUrl), this also accepts a raw mediaDataUrl upload.
const postTelegramMessage = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!token || !chatId) {
    return res.status(503).json({
      error: 'Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel.'
    });
  }

  const rawText = String(req.body?.text || '').trim();
  const mediaDataUrl = String(req.body?.mediaDataUrl || '').trim();
  const mediaName = String(req.body?.mediaName || 'telegram-media').trim();
  const mediaType = String(req.body?.mediaType || '').trim().toLowerCase();
  // This immediate-send path (used by the legacy Scheduler.tsx polling loop and its
  // "send now" button) historically sent whatever Cloudinary URL it was given as-is,
  // unlike the newer action=create path, which resizes at upload time. A full-res
  // AI-generated image/video routinely trips Telegram's "wrong type of the web page
  // content" (its way of saying "too large"), so apply the same resize here too.
  const mediaUrl = applyCloudinaryDeliveryTransform(
    String(req.body?.mediaUrl || '').trim(),
    mediaType === 'video' ? 'video' : 'photo'
  );

  if (!rawText && !mediaUrl && !mediaDataUrl) {
    return res.status(400).json({ error: 'Telegram text, image, or video is required.' });
  }

  try {
    const hasMedia = !!(mediaUrl || mediaDataUrl);
    const text = telegramTextFor(rawText, hasMedia ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_MESSAGE_LIMIT);
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
      telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          document: mediaUrl,
          caption: text || undefined,
          parse_mode: text ? 'HTML' : undefined
        })
      });
      data = await readTelegramJson(telegramRes);
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

export const sendTelegram = async (post) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!token || !chatId) {
    throw new Error('Telegram is not configured.');
  }

  const rawText = String(post.content || '').trim();
  const mediaType = String(post.mediaType || '').trim().toLowerCase();
  // A post scheduled with a pre-existing mediaUrl (rather than a fresh mediaDataUrl
  // upload) skips the resize applied in uploadMediaDataUrl -- apply it here too so
  // every send path resizes before hitting Telegram, regardless of how the URL got here.
  const mediaUrl = applyCloudinaryDeliveryTransform(
    String(post.mediaUrl || '').trim(),
    mediaType === 'video' ? 'video' : 'photo'
  );

  if (!rawText && !mediaUrl) {
    throw new Error('Post has no text or media URL.');
  }

  const text = telegramTextFor(rawText, mediaUrl ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_MESSAGE_LIMIT);

  const method = mediaUrl
    ? mediaType === 'video'
      ? 'sendVideo'
      : 'sendPhoto'
    : 'sendMessage';

  const payload = mediaUrl
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

  let response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = await response.json();

  if (mediaUrl && (!response.ok || !data.ok)) {
    response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        document: mediaUrl,
        caption: text || undefined,
        parse_mode: text ? 'HTML' : undefined
      })
    });
    data = await response.json();
  }

  if (!response.ok || !data.ok) {
    throw new Error(data?.description || 'Telegram could not publish this message.');
  }

  return data.result?.message_id || null;
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
    try {
      initFirebaseAdmin();
      return await migrateGuestData(req, res);
    } catch (error) {
      return res.status(error?.statusCode || 500).json({
        ok: false,
        error: error?.message || 'Could not preserve this guest account.'
      });
    }
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

  try {
    const db = initFirebaseAdmin();
    const nowIso = new Date().toISOString();

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

    const snapshot = await db
      .collection('scheduled_posts')
      .where('platform', '==', 'TELEGRAM')
      .where('status', '==', 'PENDING')
      .limit(25)
      .get();

    const results = [];
    const dueDocs = snapshot.docs
      .filter((doc) => String(doc.data()?.scheduledTime || '') <= nowIso)
      .sort((a, b) => String(a.data()?.scheduledTime || '').localeCompare(String(b.data()?.scheduledTime || '')))
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
        const messageId = await sendTelegram(post);

        await doc.ref.update({
          status: 'PUBLISHED',
          telegramMessageId: messageId,
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
