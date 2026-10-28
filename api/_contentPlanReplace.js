import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from './_firebaseAdmin.js';

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

export default async function replaceContentPlan(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'Sign in to save a content plan.' });
  const db = initFirebaseAdmin();
  let owner;
  try { owner = await getAuth().verifyIdToken(token, true); }
  catch { return res.status(401).json({ error: 'Sign in again.' }); }

  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length || items.length > 60 || items.some((item) =>
    !validDate(item?.scheduledDate) || !['image', 'video'].includes(item?.type)
    || !String(item?.topic || '').trim() || String(item.topic).length > 200
    || !String(item?.prompt || '').trim() || String(item.prompt).length > 2000
    || (item.type === 'video' && !/[\u1780-\u17ff]/u.test(String(item.voiceOverText || '')))
  )) return res.status(400).json({ error: 'The replacement plan contains an invalid item.' });

  const collection = db.collection('content_plan_items');
  const replacementId = collection.doc().id;
  try {
    let replacedCount = 0;
    await db.runTransaction(async (tx) => {
      const old = await tx.get(collection.where('userId', '==', owner.uid));
      const activeOld = old.docs;
      // Firestore transactions allow at most 500 writes. Fail without changing
      // anything rather than deleting only part of a customer's old plan.
      if (activeOld.length + items.length > 450) throw Object.assign(new Error('Too many existing plan items to replace at once.'), { statusCode: 409 });
      replacedCount = activeOld.length;
      activeOld.forEach((snapshot) => tx.delete(snapshot.ref));
      items.forEach((item) => {
        const ref = collection.doc();
        tx.create(ref, {
          userId: owner.uid,
          planId: replacementId,
          scheduledDate: item.scheduledDate,
          type: item.type,
          topic: String(item.topic).trim(),
          prompt: String(item.prompt).trim(),
          businessName: String(req.body?.businessName || '').slice(0, 200),
          autoPublishDestinations: true,
          ...(item.type === 'image' ? {
            headline: String(item.headline || '').slice(0, 80),
            cta: String(item.cta || '').slice(0, 30),
            aspectRatio: ['9:16', '16:9', '1:1', '3:4'].includes(item.aspectRatio) ? item.aspectRatio : '1:1',
          } : {
            voiceGender: item.voiceGender === 'Male' ? 'Male' : 'Female',
            voiceOverText: String(item.voiceOverText || '').slice(0, 500),
            scriptEditedByUser: item.scriptEditedByUser === true,
            duration: 8,
            performanceStyle: String(item.performanceStyle || '').slice(0, 1000),
            aspectRatio: ['9:16', '16:9', '1:1', '3:4'].includes(item.aspectRatio) ? item.aspectRatio : '9:16',
            voiceOverWanted: true,
            voiceOverMode: 'edge-seedance',
            productImageUrl: String(item.productImageUrl || '').slice(0, 2000),
            tiktokDirectPostConsent: item.tiktokDirectPostConsent === true,
            tiktokCommercialDisclosure: item.tiktokCommercialDisclosure === true,
            tiktokOwnBrand: item.tiktokOwnBrand === true,
            tiktokBrandedContent: item.tiktokBrandedContent === true,
          }),
          status: 'PENDING',
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    });
    return res.status(200).json({ ok: true, savedCount: items.length, replacedCount });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not replace the content plan.' });
  }
}
