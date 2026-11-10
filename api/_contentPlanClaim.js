import { FieldValue } from 'firebase-admin/firestore';
import { contentPlanDay } from './_contentPlanQuota.js';
import { contentPlanLeadMs, nextContentPlanQuotaTiming, scheduleContentPlanStart } from './_contentPlanTiming.js';
import { botCall } from './_telegramApproval.js';
import { hasUnlimitedContentPlanGeneration } from './_contentPlanEntitlements.js';

const capFor = (type) => type === 'video' ? 1 : 2;
const timestampDay = (value) => value?.toDate ? contentPlanDay(value.toDate()) : '';

export async function claimScheduledPlanItem(db, ref, now = Date.now()) {
  const candidate = (await ref.get()).data();
  const unlimitedUserId = candidate?.status === 'PENDING' && candidate.userId
    && await hasUnlimitedContentPlanGeneration(candidate.userId)
    ? candidate.userId : null;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const item = snap.data();
    if (!item || item.status !== 'PENDING' || item.supersededBy) return { skipped: 'inactive' };
    const approvalDueAt = item.approvalDueAt || item.scheduledAt;
    if (!approvalDueAt || !Number.isFinite(new Date(approvalDueAt).getTime())) return { skipped: 'invalid_time' };
    const nextGenerationAt = item.nextGenerationAt || new Date(new Date(approvalDueAt).getTime() - contentPlanLeadMs(item.type)).toISOString();
    if (new Date(nextGenerationAt).getTime() > now + 1000) return { skipped: 'early' };

    const day = contentPlanDay(new Date(now));
    if (item.userId === unlimitedUserId) {
      tx.update(ref, { status: 'PROCESSING', processingAt: FieldValue.serverTimestamp(), generationQuotaDay: day,
        quotaDeferredAt: null, quotaNoticeStatus: null, quotaMessage: null });
      return { post: { id: ref.id, ...item, approvalDueAt }, id: ref.id };
    }
    const quotaRef = db.collection('content_plan_generation_quotas').doc(`${item.userId}_${day}_${item.type}`);
    const quota = await tx.get(quotaRef);
    const ownerItems = await tx.get(db.collection('content_plan_items').where('userId', '==', item.userId));
    const usedIds = new Set(quota.data()?.itemIds || []);
    for (const previous of ownerItems.docs) {
      const data = previous.data();
      if (data?.type !== item.type || !['DONE', 'PROCESSING', 'REVIEW', 'READY'].includes(data.status)) continue;
      if (data.generationQuotaDay === day || timestampDay(data.completedAt || data.processingAt) === day) usedIds.add(previous.id);
    }
    if (usedIds.size >= capFor(item.type)) {
      const timing = nextContentPlanQuotaTiming(approvalDueAt, item.type, now);
      tx.update(ref, {
        ...timing, quotaDeferredAt: FieldValue.serverTimestamp(),
        quotaNoticeStatus: 'PENDING',
        quotaMessage: `Daily Content Plan limit reached (${capFor(item.type)} ${item.type}${capFor(item.type) > 1 ? 's' : ''} per Bangkok day). This item will generate before the same time tomorrow.`,
      });
      return { deferred: true, item: { ...item, ...timing }, id: ref.id };
    }
    usedIds.add(ref.id);
    tx.set(quotaRef, { userId: item.userId, day, type: item.type, itemIds: [...usedIds], updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { status: 'PROCESSING', processingAt: FieldValue.serverTimestamp(), generationQuotaDay: day,
      quotaDeferredAt: null, quotaNoticeStatus: null, quotaMessage: null });
    return { post: { id: ref.id, ...item, approvalDueAt }, id: ref.id };
  });
  if (result.deferred) {
    try { await scheduleContentPlanStart(ref.id, result.item.nextGenerationAt, db); }
    catch (error) { await ref.update({ quotaRetrySchedulingError: String(error?.message || error).slice(0, 300) }); }
    await sendQuotaNotice(db, ref).catch((error) => console.error('Content Plan quota notice failed:', error));
  }
  return result;
}

export async function sendQuotaNotice(db, ref) {
  const notice = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const item = snap.data();
    if (!item || !['PENDING', 'SEND_FAILED'].includes(item.quotaNoticeStatus)) return null;
    tx.update(ref, { quotaNoticeStatus: 'REQUESTING' });
    return item;
  });
  if (!notice) return false;
  try {
    const link = (await db.collection('telegram_approval_links').doc(notice.userId).get()).data();
    const botOwnerId = String(link?.botOwnerId || notice.userId);
    const profile = (await db.collection('business_profiles').doc(botOwnerId).get()).data();
    if (!link?.chatId || !link?.telegramUserId || String(link.chatId) !== String(link.telegramUserId)
      || !profile?.telegramBotToken || profile.telegramBotActive !== true) {
      throw Object.assign(new Error('A private approval bot chat is not connected.'), { retryable: true });
    }
    const when = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(notice.approvalDueAt));
    await botCall('sendMessage', { chat_id: link.chatId,
      text: `${notice.quotaMessage}\n\nPlan: ${String(notice.topic || '').slice(0, 150)}\nNext approval time: ${when} (Bangkok).`,
    }, profile.telegramBotToken);
    await ref.update({ quotaNoticeStatus: 'SENT', quotaNotifiedAt: FieldValue.serverTimestamp() });
    return true;
  } catch (error) {
    await ref.update({ quotaNoticeStatus: error?.telegramRejected || error?.retryable ? 'SEND_FAILED' : 'SEND_UNCERTAIN', quotaNoticeError: String(error?.message || error).slice(0, 300) });
    return false;
  }
}
