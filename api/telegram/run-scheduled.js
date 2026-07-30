import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'crypto';

const initFirebaseAdmin = () => {
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

const createGuestToken = async (res) => {
  const uid = `guest_${randomBytes(18).toString('hex')}`;
  const token = await admin.auth().createCustomToken(uid, { guest: true });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, token });
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

  return {
    mediaUrl: data.secure_url,
    mediaType: mediaType || (data.resource_type === 'video' ? 'video' : contentType.startsWith('video/') ? 'video' : 'photo')
  };
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
  if (!scheduledTime || Number.isNaN(scheduledDate.getTime()) || scheduledDate < new Date()) {
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

  return res.status(200).json({ ok: true, id: docRef.id });
};

const sendTelegram = async (post) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!token || !chatId) {
    throw new Error('Telegram is not configured.');
  }

  const text = String(post.content || '').trim();
  const mediaUrl = String(post.mediaUrl || '').trim();
  const mediaType = String(post.mediaType || '').trim().toLowerCase();

  if (!text && !mediaUrl) {
    throw new Error('Post has no text or media URL.');
  }

  const method = mediaUrl
    ? mediaType === 'video'
      ? 'sendVideo'
      : 'sendPhoto'
    : 'sendMessage';

  const payload = mediaUrl
    ? {
        chat_id: chatId,
        [mediaType === 'video' ? 'video' : 'photo']: mediaUrl,
        caption: text || undefined
      }
    : {
        chat_id: chatId,
        text,
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
        caption: text || undefined
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
      initFirebaseAdmin();
      return await createGuestToken(res);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message || 'Could not start a guest session.'
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

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    const querySecret = req.query?.secret;
    if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = initFirebaseAdmin();
    const nowIso = new Date().toISOString();
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
      const post = { id: doc.id, ...doc.data() };
      try {
        await doc.ref.update({
          status: 'PROCESSING',
          processingAt: FieldValue.serverTimestamp()
        });

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
      }
    }

    return res.status(200).json({
      ok: true,
      checkedAt: nowIso,
      processed: results.length,
      results
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Scheduled Telegram runner failed.'
    });
  }
}
