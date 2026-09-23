import { Receiver } from '@upstash/qstash';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { getAutomationAccessToken } from '../_tiktok.js';
import { deliverOneScheduledTikTokPost } from './publish.js';
import { notifyAdmins } from '../_alert.js';

// QStash's precise per-post callback for TikTok scheduling (see
// scheduleTikTokQStashDelivery in ../_tiktok.js for why this exists rather
// than relying solely on the periodic poller). Mirrors api/telegram/deliver.js's
// signature-verification shape exactly.
export const config = {
  api: { bodyParser: false },
};

const getRawBody = (req) => {
  if (typeof req.rawBody === 'string') return Promise.resolve(req.rawBody);
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody.toString('utf8'));
  if (req.readableEnded || req.complete) {
    return Promise.resolve(req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || ''));
  }
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    console.error('QStash signing keys are not configured; refusing unsigned delivery work.');
    return res.status(500).json({ error: 'QStash signing keys are not configured.' });
  }
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

    let token;
    try {
      token = await getAutomationAccessToken(db);
    } catch (error) {
      const message = error?.message || 'TikTok token refresh failed.';
      await notifyAdmins(`TikTok auto-publish token refresh failed (QStash delivery for ${postId}): ${message}`);
      // Leave the post PENDING -- the periodic poller will retry once the
      // automation token issue is resolved, same as its own token-refresh
      // failure path.
      return res.status(200).json({ ok: true, skipped: 'token_refresh_failed' });
    }
    if (!token) {
      return res.status(200).json({ ok: true, skipped: 'not_connected' });
    }

    const result = await deliverOneScheduledTikTokPost(db, ref, token);
    if (!result.ok) {
      await notifyAdmins(`TikTok scheduled post ${postId} failed (QStash): ${result.error}`);
    }
    return res.status(200).json(result);
  } catch (error) {
    const message = error?.message || 'Delivery failed.';
    await notifyAdmins(`TikTok QStash delivery crashed for post ${postId}: ${message}`);
    return res.status(500).json({ ok: false, error: message });
  }
}
