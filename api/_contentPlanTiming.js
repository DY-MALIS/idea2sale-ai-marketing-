import { Client as QStashClient } from '@upstash/qstash';
import { getScheduledCallbackBaseUrl } from './_callbackUrl.js';

export const contentPlanLeadMs = (type) => type === 'video' ? 15 * 60_000 : 5 * 60_000;

export const contentPlanTiming = (scheduledAt, type, now = Date.now()) => {
  const due = new Date(scheduledAt).getTime();
  if (!Number.isFinite(due)) throw new Error('Invalid Content Plan scheduled time.');
  return {
    approvalDueAt: new Date(due).toISOString(),
    nextGenerationAt: new Date(Math.max(now, due - contentPlanLeadMs(type))).toISOString(),
  };
};

// Asia/Bangkok has no daylight-saving shift, so adding a day preserves the
// customer's local clock time when a daily quota defers an item.
export const nextContentPlanQuotaTiming = (approvalDueAt, type, now = Date.now()) => {
  let due = new Date(approvalDueAt).getTime();
  if (!Number.isFinite(due)) throw new Error('Invalid Content Plan approval time.');
  do { due += 24 * 60 * 60_000; } while (due - contentPlanLeadMs(type) <= now);
  return { approvalDueAt: new Date(due).toISOString(), nextGenerationAt: new Date(due - contentPlanLeadMs(type)).toISOString() };
};

const qstashClient = () => {
  const token = String(process.env.QSTASH_TOKEN || '').trim();
  if (!token) throw new Error('QSTASH_TOKEN is not configured.');
  return new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
};

export async function cancelContentPlanStart(messageId) {
  if (messageId) await qstashClient().messages.delete(messageId);
}

export async function scheduleContentPlanStart(itemId, nextGenerationAt, db = null) {
  const client = qstashClient();
  const queued = await client.publishJSON({
    url: `${getScheduledCallbackBaseUrl()}/api/telegram/deliver`,
    body: { contentPlanStartId: itemId },
    notBefore: Math.max(Math.ceil(Date.now() / 1000) + 1, Math.ceil(new Date(nextGenerationAt).getTime() / 1000)),
  });
  if (db && queued?.messageId) {
    const ref = db.collection('content_plan_items').doc(itemId);
    const active = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data()?.status !== 'PENDING' || snap.data()?.nextGenerationAt !== nextGenerationAt) return false;
      tx.update(ref, { generationTriggerMessageId: queued.messageId });
      return true;
    });
    if (!active) await cancelContentPlanStart(queued.messageId);
  }
  return queued;
}
