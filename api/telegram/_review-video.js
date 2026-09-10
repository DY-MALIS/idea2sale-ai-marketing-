import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';

export default async function reviewVideoHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'Sign in to review videos.' });
  const db = initFirebaseAdmin();
  let user;
  try { user = await getAuth().verifyIdToken(token, true); }
  catch { return res.status(401).json({ error: 'Sign in again.' }); }
  const { itemId, action, mediaUrl } = req.body || {};
  if (!/^[\w-]{10,128}$/.test(itemId || '') || !['approve', 'retry'].includes(action)) {
    return res.status(400).json({ error: 'Invalid video review request.' });
  }
  try {
    await db.runTransaction(async transaction => {
      const ref = db.collection('content_plan_items').doc(itemId);
      const snap = await transaction.get(ref);
      const item = snap.data();
      if (!item || item.userId !== user.uid) throw new Error('Video not found.');
      if (action === 'retry') {
        if (!['FAILED', 'REVIEW'].includes(item.status)) throw new Error('This item cannot be retried.');
        transaction.update(ref, { status: 'PENDING', errorMessage: null, resultMediaUrl: null, speechVerification: null, narrationAudio: null, videoJobId: null });
        return;
      }
      if (item.status !== 'REVIEW' || item.type !== 'video' || !item.speechVerification?.passed || !mediaUrl || mediaUrl !== item.resultMediaUrl) {
        throw new Error('This video is not ready for approval. Refresh and review the current video.');
      }
      const post = db.collection('scheduled_posts').doc(`review-${itemId}`);
      transaction.set(post, {
        userId: user.uid, content: item.topic || '', platform: 'TELEGRAM',
        mediaUrl: item.resultMediaUrl, mediaType: 'video', status: 'PENDING',
        scheduledTime: new Date().toISOString(), publishMode: 'TELEGRAM_AUTO_POST',
        createdAt: FieldValue.serverTimestamp(), aiSuggested: false,
      });
      transaction.update(ref, {
        status: 'DONE', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: user.uid,
        'speechVerification.naturalnessReviewed': true, approvedPostId: post.id,
      });
    });
    return res.status(200).json({ ok: true, queued: action === 'approve' });
  } catch (error) {
    return res.status(409).json({ error: error.message || 'Could not update the video.' });
  }
}
