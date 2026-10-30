// Read/write production smoke check for two temporary guest accounts.
// Does not call AI, OpenRouter, or publishing endpoints. Created documents
// are removed in finally; the Firebase guest identities remain temporary.
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where } from 'firebase/firestore';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const origin = 'https://aime.angkorgate.ai';
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
if (!config.apiKey || !config.projectId || !databaseId) throw new Error('Local Firebase public configuration is missing.');

async function guest(label) {
  const response = await fetch(`${origin}/api/telegram/run-scheduled?action=guest-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const data = await response.json();
  if (!response.ok || !data.token) throw new Error(`Guest ${label} token failed: HTTP ${response.status}`);
  const app = initializeApp(config, `smoke-${label}-${randomUUID()}`);
  const auth = getAuth(app);
  const credential = await signInWithCustomToken(auth, data.token);
  return { app, auth, db: getFirestore(app, databaseId), uid: credential.user.uid };
}

async function expectDenied(action, label) {
  try {
    await action();
  } catch (error) {
    if (error?.code === 'permission-denied') return;
    throw error;
  }
  throw new Error(`${label}: cross-account access was allowed`);
}

const users = [];
const created = [];
try {
  const a = await guest('a'); users.push(a);
  const b = await guest('b'); users.push(b);
  if (a.uid === b.uid) throw new Error('Guest identities were reused');

  for (const owner of [a, b]) {
    const ref = doc(owner.db, 'saved_leads', `smoke_${randomUUID().replaceAll('-', '')}`);
    await setDoc(ref, {
      ownerId: owner.uid, businessName: 'Isolation Smoke Test', businessType: 'Test',
      recommendedService: 'Test', inboxMessage: 'Temporary test record',
    });
    created.push({ owner, ref });
    if (!(await getDoc(ref)).exists()) throw new Error('Owner cannot read own lead');
  }

  const [aDoc, bDoc] = created;
  await expectDenied(() => getDoc(doc(b.db, 'saved_leads', aDoc.ref.id)), 'B reads A');
  await expectDenied(() => getDoc(doc(a.db, 'saved_leads', bDoc.ref.id)), 'A reads B');
  await expectDenied(() => setDoc(doc(b.db, 'saved_leads', aDoc.ref.id), { ownerId: b.uid }, { merge: true }), 'B writes A');
  await expectDenied(() => getDocs(query(collection(b.db, 'saved_leads'), where('ownerId', '==', a.uid))), 'B lists A');
  const ownA = await getDocs(query(collection(a.db, 'saved_leads'), where('ownerId', '==', a.uid)));
  const ownB = await getDocs(query(collection(b.db, 'saved_leads'), where('ownerId', '==', b.uid)));
  if (!ownA.docs.some((item) => item.id === aDoc.ref.id) || !ownB.docs.some((item) => item.id === bDoc.ref.id)) {
    throw new Error('Owner-scoped list omitted its own lead');
  }
  console.log('PASS: two distinct production guest accounts; own create/read/list; cross-account read/write/list denied.');
} finally {
  for (const { owner, ref } of created) {
    try { await deleteDoc(ref); } catch (error) { console.error(`Cleanup failed for ${ref.id}: ${error?.code || error}`); }
  }
  for (const { app, auth } of users) {
    try { await signOut(auth); await deleteApp(app); } catch { /* process exits */ }
  }
}
