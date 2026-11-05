import dotenv from 'dotenv';
import { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const db = initFirebaseAdmin();
const rules = await db.collection('reply_rules').where('platform', '==', 'TELEGRAM').get();
const counts = new Map();
for (const doc of rules.docs) {
  const uid = doc.data()?.userId || '';
  counts.set(uid, (counts.get(uid) || 0) + 1);
}
const owners = [];
for (const [uid, count] of counts) {
  const profile = uid ? (await db.collection('business_profiles').doc(uid).get()).data() : null;
  const admin = uid ? (await db.collection('admins').doc(uid).get()).exists : false;
  owners.push({ businessName: profile?.businessName || '(no profile)', count, admin, hasOwnBot: Boolean(profile?.telegramBotActive) });
}
process.stdout.write(`${JSON.stringify({ ruleCount: rules.size, owners })}\n`);
