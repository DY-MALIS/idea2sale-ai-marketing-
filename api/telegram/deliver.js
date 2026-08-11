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

    // Claim the post atomically: the QStash webhook and the cron/GitHub Actions
    // poller can both race to deliver the same post around its due time, and a
    // plain get()-then-update() has a window where both see status "PENDING"
    // and both publish to Telegram. A transaction makes the PENDING -> PROCESSING
    // claim compare-and-swap so only one caller wins.
    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { skipped: 'not_found' };
      const data = { id: snap.id, ...snap.data() };
      if (data.status !== 'PENDING') return { skipped: data.status };
      tx.update(ref, { status: 'PROCESSING', processingAt: FieldValue.serverTimestamp() });
      return { post: data };
    });

    if (claim.skipped) {
      return res.status(200).json({ ok: true, skipped: claim.skipped });
    }

    const post = claim.post;

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
