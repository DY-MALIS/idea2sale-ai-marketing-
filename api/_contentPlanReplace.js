import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { Client as QStashClient } from '@upstash/qstash';
import { initFirebaseAdmin } from './_firebaseAdmin.js';
import { getScheduledCallbackBaseUrl } from './_callbackUrl.js';

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const validTime = (value) => value == null || value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
const scheduledAtFor = (item) => {
  if (item.scheduledTime) {
    const timestamp = new Date(item.scheduledAt || '');
    if (Number.isNaN(timestamp.getTime())) return null;
    return timestamp.toISOString();
  }
  // Legacy date-only plans run at the start of the date in Cambodia.
  return new Date(`${item.scheduledDate}T00:00:00+07:00`).toISOString();
};

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
    !validDate(item?.scheduledDate) || !validTime(item?.scheduledTime)
    || !scheduledAtFor(item) || !['image', 'video'].includes(item?.type)
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
          scheduledAt: scheduledAtFor(item),
          scheduledTime: String(item.scheduledTime || ''),
          type: item.type,
          topic: String(item.topic).trim(),
          prompt: String(item.prompt).trim(),
          businessName: String(req.body?.businessName || '').slice(0, 200),
          autoPublishDestinations: true,
          approvalRequired: true,
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
    const scheduleTimes = [...new Set(items.map(scheduledAtFor))];
    let schedulingWarning = null;
    try {
      const token = String(process.env.QSTASH_TOKEN || '').trim();
      if (!token) throw new Error('QSTASH_TOKEN is not configured.');
      const client = new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
      const callbackUrl = `${getScheduledCallbackBaseUrl()}/api/telegram/deliver`;
      for (const scheduledAt of scheduleTimes) {
        await client.publishJSON({
          url: callbackUrl,
          body: { runContentPlan: true },
          notBefore: Math.max(Math.floor(Date.now() / 1000) + 1, Math.floor(new Date(scheduledAt).getTime() / 1000)),
        });
      }
    } catch (error) {
      console.error('Content plan wake-up scheduling failed:', error);
      schedulingWarning = 'The plan was saved, but its automatic trigger could not be scheduled. Contact support before relying on its posting time.';
    }
    return res.status(200).json({ ok: true, savedCount: items.length, replacedCount, schedulingWarning });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not replace the content plan.' });
  }
}
