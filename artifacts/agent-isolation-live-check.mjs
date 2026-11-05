import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import admin, { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const db = initFirebaseAdmin();
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const uids = [`codex_agent_${suffix}_a`, `codex_agent_${suffix}_b`];
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const apps = [];
const records = [];

try {
  const clients = [];
  for (const [index, uid] of uids.entries()) {
    const app = initializeApp(config, `agent-isolation-${suffix}-${index}`);
    apps.push(app);
    const customToken = await admin.auth().createCustomToken(uid, { guest: true });
    await signInWithCustomToken(getAuth(app), customToken);
    clients.push(databaseId ? getFirestore(app, databaseId) : getFirestore(app));
  }
  const ownRefs = uids.map((uid, index) => doc(clients[index], 'agent_conversations', uid));
  for (const [index, ref] of ownRefs.entries()) {
    records.push(uids[index]);
    await setDoc(ref, { userId: uids[index], messages: [{ role: 'user', content: `Private agent memory ${index}` }], sessions: [] });
    if (!(await getDoc(ref)).exists()) throw new Error(`Owner ${index} could not read agent memory`);
  }
  let crossReadDenied = false;
  try { await getDoc(doc(clients[1], 'agent_conversations', uids[0])); }
  catch (error) { crossReadDenied = error?.code === 'permission-denied'; }
  let crossWriteDenied = false;
  try { await setDoc(doc(clients[1], 'agent_conversations', uids[0]), { userId: uids[1], messages: [], sessions: [] }); }
  catch (error) { crossWriteDenied = error?.code === 'permission-denied'; }
  if (!crossReadDenied || !crossWriteDenied) throw new Error('Cross-account agent memory was accessible');
  process.stdout.write(`${JSON.stringify({ ownerReadWrite: 'pass', crossRead: 'denied', crossWrite: 'denied' })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error?.message || String(error) })}\n`);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    ...records.map(uid => db.collection('agent_conversations').doc(uid).delete()),
    ...uids.map(uid => admin.auth().deleteUser(uid)),
    ...apps.map(app => deleteApp(app)),
  ]);
  const failures = cleanup.filter(item => item.status === 'rejected' && item.reason?.code !== 'auth/user-not-found').length;
  process.stdout.write(`${JSON.stringify({ cleanup: failures ? 'incomplete' : 'complete', failures })}\n`);
  if (failures) process.exitCode = 1;
}
