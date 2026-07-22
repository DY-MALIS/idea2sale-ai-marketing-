import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

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

const getStorageBucket = () => {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    throw new Error('FIREBASE_STORAGE_BUCKET is not configured.');
  }
  return admin.storage().bucket(bucketName);
};

const uploadMediaDataUrl = async ({ userId, mediaDataUrl, mediaName, mediaType }) => {
  if (!mediaDataUrl) return { mediaUrl: '', mediaType: null };

  const match = String(mediaDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid media file data.');
  }

  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = 4 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error('This media file is too large for web scheduling. Please use a file under 4 MB.');
  }

  const token = crypto.randomUUID();
  const safeName = String(mediaName || 'telegram-media').replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `telegram-media/${userId}/${Date.now()}-${safeName}`;
  const file = getStorageBucket().file(objectPath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token
      }
    }
  });

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
  const encodedPath = encodeURIComponent(objectPath);
  return {
    mediaUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`,
    mediaType: mediaType || (contentType.startsWith('video/') ? 'video' : 'photo')
  };
};

const createScheduledTelegramPost = async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Please sign in before scheduling auto-posts.' });
  }

  const decoded = await admin.auth().verifyIdToken(token, true);
  const content = String(req.body?.content || '').trim();
  const scheduledTime = String(req.body?.scheduledTime || '').trim();
  const mediaDataUrl = String(req.body?.mediaDataUrl || '').trim();
  const mediaName = String(req.body?.mediaName || '').trim();
  const requestedMediaType = String(req.body?.mediaType || '').trim().toLowerCase();

  if (!content && !mediaDataUrl) {
    return res.status(400).json({ error: 'Text or media is required.' });
  }

  const scheduledDate = new Date(scheduledTime);
  if (!scheduledTime || Number.isNaN(scheduledDate.getTime()) || scheduledDate < new Date()) {
    return res.status(400).json({ error: 'Please choose a future publish time.' });
  }

  const db = initFirebaseAdmin();
  const uploaded = await uploadMediaDataUrl({
    userId: decoded.uid,
    mediaDataUrl,
    mediaName,
    mediaType: requestedMediaType
  });

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

  if (req.method === 'POST' && req.query?.action === 'create') {
    try {
      initFirebaseAdmin();
      return await createScheduledTelegramPost(req, res);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message || 'Could not schedule this Telegram post.'
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
