import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from './_firebaseAdmin.js';
import { cancelContentPlanStart, contentPlanTiming, scheduleContentPlanStart } from './_contentPlanTiming.js';

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
    let createdItems = [];
    let cancelledTriggers = [];
    await db.runTransaction(async (tx) => {
      const old = await tx.get(collection.where('userId', '==', owner.uid));
      const existingPosts = await tx.get(db.collection('scheduled_posts').where('userId', '==', owner.uid));
      const retainIds = new Set(existingPosts.docs.filter((snapshot) => {
        const post = snapshot.data();
        return post.sourcePlanItemId && post.approvalRequired === true
          && (post.status === 'PUBLISHED' || (
            ['PENDING', 'AWAITING_APPROVAL', 'PROCESSING'].includes(post.status)
            && ['REQUESTED', 'REQUESTING', 'SEND_UNCERTAIN', 'APPROVED'].includes(post.approvalStatus)));
      }).map((snapshot) => snapshot.data().sourcePlanItemId));
      const activeOld = old.docs;
      cancelledTriggers = activeOld.filter((snapshot) => snapshot.data()?.status === 'PENDING')
        .map((snapshot) => snapshot.data()?.generationTriggerMessageId).filter(Boolean);
      // Firestore transactions allow at most 500 writes. Fail without changing
      // anything rather than deleting only part of a customer's old plan.
      const unsentPosts = existingPosts.docs.filter((snapshot) => snapshot.data()?.sourcePlanItemId
        && ['PENDING', 'AWAITING_APPROVAL'].includes(snapshot.data()?.status)
        && ['AWAITING_DUE', 'AWAITING_LINK', 'SEND_FAILED'].includes(snapshot.data()?.approvalStatus));
      const oldWrites = activeOld.length + unsentPosts.length;
      if (oldWrites + items.length > 450) throw Object.assign(new Error('Too many existing plan items to replace at once.'), { statusCode: 409 });
      replacedCount = activeOld.filter((snapshot) => !snapshot.data()?.archivedAt).length;
      unsentPosts.forEach((snapshot) => tx.update(snapshot.ref, {
        status: 'CANCELLED', approvalStatus: 'REJECTED', cancelledReason: 'Content Plan was replaced.',
      }));
      activeOld.forEach((snapshot) => {
        if (retainIds.has(snapshot.id) || ['DELETING', 'DELETE_FAILED'].includes(snapshot.data()?.status)) {
          if (!snapshot.data()?.archivedAt) tx.update(snapshot.ref, { archivedAt: FieldValue.serverTimestamp() });
        } else if (snapshot.data()?.resultMediaUrl || snapshot.data()?.status === 'PROCESSING') {
          tx.update(snapshot.ref, {
            status: 'DELETING', supersededBy: replacementId, archivedAt: FieldValue.serverTimestamp(),
            deletionClaimedAt: null,
          });
        } else tx.delete(snapshot.ref);
      });
      createdItems = [];
      items.forEach((item) => {
        const ref = collection.doc();
        const timing = contentPlanTiming(scheduledAtFor(item), item.type);
        createdItems.push({ id: ref.id, nextGenerationAt: timing.nextGenerationAt });
        tx.create(ref, {
          userId: owner.uid,
          planId: replacementId,
          scheduledDate: item.scheduledDate,
          scheduledAt: scheduledAtFor(item),
          ...timing,
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
    const cancellations = await Promise.allSettled(cancelledTriggers.map((messageId) => cancelContentPlanStart(messageId)));
    for (const outcome of cancellations.filter((entry) => entry.status === 'rejected')) {
      console.warn('Could not cancel a superseded Content Plan trigger:', outcome.reason);
    }
    let schedulingWarning = null;
    try {
      const outcomes = await Promise.allSettled(createdItems.map((item) => scheduleContentPlanStart(item.id, item.nextGenerationAt, db)));
      if (outcomes.some((outcome) => outcome.status === 'rejected')) throw outcomes.find((outcome) => outcome.status === 'rejected').reason;
    } catch (error) {
      console.error('Content plan wake-up scheduling failed:', error);
      schedulingWarning = 'The plan was saved, but its automatic trigger could not be scheduled. Contact support before relying on its posting time.';
    }
    return res.status(200).json({ ok: true, savedCount: items.length, replacedCount, schedulingWarning });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || 'Could not replace the content plan.' });
  }
}
