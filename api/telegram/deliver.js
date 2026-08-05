import { Receiver } from '@upstash/qstash';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdmin, sendTelegram } from './run-scheduled.js';

export const config = {
  api: { bodyParser: false },
};

const getRawBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (currentSigningKey && nextSigningKey) {
    const signature = req.headers['upstash-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Missing QStash signature.' });
    }
    try {
      const receiver = new Receiver({ currentSigningKey, nextSigningKey });
      const isValid = await receiver.verify({ signature, body: rawBody });
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid QStash signature.' });
      }
    } catch (error) {
      return res.status(401).json({ error: error?.message || 'QStash signature verification failed.' });
    }
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  const postId = String(payload?.postId || '').trim();
  if (!postId) {
    return res.status(400).json({ error: 'postId is required.' });
  }

  try {
    const db = initFirebaseAdmin();
    const ref = db.collection('scheduled_posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(200).json({ ok: true, skipped: 'not_found' });
    }

    const post = { id: snap.id, ...snap.data() };
    if (post.status !== 'PENDING') {
      return res.status(200).json({ ok: true, skipped: post.status });
    }

    await ref.update({ status: 'PROCESSING', processingAt: FieldValue.serverTimestamp() });

    try {
      const messageId = await sendTelegram(post);
      await ref.update({
        status: 'PUBLISHED',
        telegramMessageId: messageId,
        publishedAt: FieldValue.serverTimestamp(),
        errorMessage: null,
      });
      return res.status(200).json({ ok: true, messageId });
    } catch (error) {
      const message = error?.message || 'Telegram publish failed.';
      await ref.update({ status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp() });
      return res.status(200).json({ ok: false, error: message });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Delivery failed.' });
  }
}
