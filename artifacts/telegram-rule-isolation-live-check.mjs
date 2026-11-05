import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc } from 'firebase/firestore';
import admin, { initFirebaseAdmin } from '../api/_firebaseAdmin.js';
import { findMatchingReplyRule } from '../api/telegram/webhook.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const db = initFirebaseAdmin();
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const uids = [`codex_rules_${suffix}_a`, `codex_rules_${suffix}_b`];
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const apps = [];
const refs = [];
const trigger = `codexrule${suffix}`;
try {
  const clients = [];
  for (const [index, uid] of uids.entries()) {
    const app = initializeApp(config, `rule-check-${suffix}-${index}`);
    apps.push(app);
    const token = await admin.auth().createCustomToken(uid, { guest: true });
    await signInWithCustomToken(getAuth(app), token);
    clients.push(databaseId ? getFirestore(app, databaseId) : getFirestore(app));
  }
  for (const [index, uid] of uids.entries()) {
    const id = `codexrules_${suffix}_${index}`;
    const ref = doc(clients[index], 'reply_rules', id);
    refs.push(id);
    await setDoc(ref, { userId: uid, platform: 'TELEGRAM', trigger, response: `Private ${index}` });
    let flagDenied = false;
    try { await updateDoc(ref, { sharedBot: true }); }
    catch (error) { flagDenied = error?.code === 'permission-denied'; }
    if (!flagDenied) throw new Error(`Account ${index} could mark its rule as shared`);
  }
  const ownA = await findMatchingReplyRule(db, trigger, uids[0]);
  const ownB = await findMatchingReplyRule(db, trigger, uids[1]);
  const shared = await findMatchingReplyRule(db, trigger, null);
  if (ownA !== 'Private 0' || ownB !== 'Private 1' || shared !== null) {
    throw new Error('Telegram reply rules crossed account or shared-bot boundaries');
  }
  const designated = await db.collection('reply_rules').where('sharedBot', '==', true).get();
  const onlyAdmin = await Promise.all(designated.docs.map(async rule =>
    (await db.collection('admins').doc(rule.data()?.userId || '_').get()).exists));
  if (onlyAdmin.some(value => !value)) throw new Error('Non-admin shared-bot rule exists');
  process.stdout.write(`${JSON.stringify({ ownRules: 'separate', sharedBotExcludedPrivateRules: true, nonAdminSharedFlagDenied: true, designatedSharedRules: designated.size, allDesignatedRulesAdminOwned: true })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error?.message || String(error) })}\n`);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    ...refs.map(id => db.collection('reply_rules').doc(id).delete()),
    ...uids.map(uid => admin.auth().deleteUser(uid)),
    ...apps.map(app => deleteApp(app)),
  ]);
  const failures = cleanup.filter(item => item.status === 'rejected' && item.reason?.code !== 'auth/user-not-found').length;
  process.stdout.write(`${JSON.stringify({ cleanup: failures ? 'incomplete' : 'complete', failures })}\n`);
  if (failures) process.exitCode = 1;
}
