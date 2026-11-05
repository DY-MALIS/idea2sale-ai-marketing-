import dotenv from 'dotenv';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import admin, { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const adminDb = initFirebaseAdmin();
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const base = 'https://aime.angkorgate.ai';
const uids = [];
const apps = [];
const profiles = [];
try {
for (let index = 0; index < 2; index++) {
  const response = await fetch(`${base}/api/telegram/run-scheduled?action=guest-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: 'same-client-chosen-id' }),
  });
  const body = await response.json();
  if (!response.ok || !body.token) throw new Error(`Guest token request ${index + 1} failed: HTTP ${response.status}`);
  const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString('utf8'));
  uids.push(payload.uid);
  const app = initializeApp(config, `live-guest-${index}-${Date.now()}`);
  apps.push(app);
  const signedIn = await signInWithCustomToken(getAuth(app), body.token);
  if (signedIn.user.uid !== payload.uid) throw new Error('Guest token authenticated as a different account');
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  profiles.push(doc(db, 'business_profiles', signedIn.user.uid));
}
const distinct = uids[0] !== uids[1];
const serverIssued = uids.every(uid => /^guest_device_[a-f0-9]{40}$/.test(uid));
if (!distinct || !serverIssued) throw new Error('Guest identity is reusable or client-chosen');
await setDoc(profiles[0], { userId: uids[0], businessName: 'Guest Isolation A', logoDataUrl: '', directory: [] });
if (!(await getDoc(profiles[0])).exists()) throw new Error('Guest owner could not read own profile');
let crossReadDenied = false;
try {
  const otherDb = databaseId ? getFirestore(apps[1], databaseId) : getFirestore(apps[1]);
  await getDoc(doc(otherDb, 'business_profiles', uids[0]));
} catch (error) { crossReadDenied = error?.code === 'permission-denied'; }
if (!crossReadDenied) throw new Error('Other guest could read first guest profile');
const migration = await fetch(`${base}/api/telegram/run-scheduled?action=migrate-guest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
if (migration.status !== 410) throw new Error(`Legacy guest migration remained active: HTTP ${migration.status}`);
process.stdout.write(`${JSON.stringify({ distinctGuestUids: distinct, serverIssued, ownProfileRead: true, crossProfileReadDenied: true, legacyMigrationDisabled: true })}\n`);
} finally {
  const cleanup = await Promise.allSettled([
    ...uids.map(uid => adminDb.collection('business_profiles').doc(uid).delete()),
    ...uids.map(uid => admin.auth().deleteUser(uid)),
    ...apps.map(app => deleteApp(app)),
  ]);
  const failures = cleanup.filter(item => item.status === 'rejected' && item.reason?.code !== 'auth/user-not-found').length;
  process.stdout.write(`${JSON.stringify({ cleanup: failures ? 'incomplete' : 'complete', failures })}\n`);
  if (failures) process.exitCode = 1;
}
