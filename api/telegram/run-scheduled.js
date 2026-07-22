import admin from 'firebase-admin';

const initFirebaseAdmin = () => {
  if (admin.apps.length) return admin.firestore();

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured.');
  }

  if (clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId
    });
  } else {
    admin.initializeApp({ projectId });
  }

  const db = admin.firestore();
  const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
  if (databaseId) db.settings({ databaseId });
  return db;
};

const sendTelegram = async (post) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!token || !chatId) {
    throw new Error('Telegram is not configured.');
  }

  const text = String(post.content || '').trim();
  const mediaUrl = String(post.mediaUrl || '').trim();
  const mediaName = String(post.mediaName || 'telegram-media').trim();
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
          processingAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const messageId = await sendTelegram(post);

        await doc.ref.update({
          status: 'PUBLISHED',
          telegramMessageId: messageId,
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
          errorMessage: null
        });

        results.push({ id: doc.id, ok: true, messageId });
      } catch (error) {
        const message = error?.message || 'Telegram publish failed.';
        await doc.ref.update({
          status: 'FAILED',
          errorMessage: message,
          failedAt: admin.firestore.FieldValue.serverTimestamp()
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
