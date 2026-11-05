import dotenv from 'dotenv';
import { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const db = initFirebaseAdmin();
const snapshot = await db.collection('reply_rules').where('platform', '==', 'TELEGRAM').get();
let marked = 0;
for (const rule of snapshot.docs) {
  const uid = rule.data()?.userId;
  if (!uid) continue;
  const isAdmin = (await db.collection('admins').doc(uid).get()).exists;
  if (!isAdmin || rule.data()?.sharedBot === true) continue;
  await rule.ref.update({ sharedBot: true });
  marked++;
}
process.stdout.write(`${JSON.stringify({ adminRulesMarkedForSharedBot: marked })}\n`);
