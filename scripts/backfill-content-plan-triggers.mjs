import 'dotenv/config';
import { initFirebaseAdmin } from '../api/_firebaseAdmin.js';
import { contentPlanTiming, scheduleContentPlanStart } from '../api/_contentPlanTiming.js';

const apply = process.argv.includes('--apply');
const db = initFirebaseAdmin();
const snapshot = await db.collection('content_plan_items').where('status', '==', 'PENDING').get();
let candidates = 0;
let scheduled = 0;
let failed = 0;
for (const doc of snapshot.docs) {
  const item = doc.data();
  if (!item.scheduledAt || !['image', 'video'].includes(item.type)) continue;
  const timing = item.approvalDueAt && item.nextGenerationAt
    ? { approvalDueAt: item.approvalDueAt, nextGenerationAt: item.nextGenerationAt }
    : contentPlanTiming(item.scheduledAt, item.type);
  candidates += 1;
  if (!apply) continue;
  try {
    if (!item.approvalDueAt || !item.nextGenerationAt) await doc.ref.update(timing);
    await scheduleContentPlanStart(doc.id, timing.nextGenerationAt, db);
    scheduled += 1;
  } catch (error) {
    failed += 1;
    console.error(`Could not schedule Content Plan item ${doc.id}:`, error?.message || error);
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates, scheduled, failed }));
if (failed) process.exitCode = 1;
