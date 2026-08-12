import { FieldValue } from 'firebase-admin/firestore';

// Atomically claims a scheduled post for delivery: reads the doc, and only if
// it is still PENDING, flips it to PROCESSING in the same transaction. Used by
// both api/telegram/deliver.js (QStash webhook) and api/telegram/run-scheduled.js
// (cron poller) — both can race to deliver the same post around its due time,
// and a plain get()-then-update() has a window where both see "PENDING" and
// both publish to Telegram. The transaction makes the claim compare-and-swap
// so only one caller ever wins it.
export async function claimPendingPost(db, ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { skipped: 'not_found' };
    const data = { id: snap.id, ...snap.data() };
    if (data.status !== 'PENDING') return { skipped: data.status };
    tx.update(ref, { status: 'PROCESSING', processingAt: FieldValue.serverTimestamp() });
    return { post: data };
  });
}
