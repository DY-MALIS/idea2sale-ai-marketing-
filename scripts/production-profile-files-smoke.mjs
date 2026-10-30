import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
const origin = 'https://aime.angkorgate.ai';
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const users = [];
let uploadedId = '';
let owner = null;
async function guest(label) {
  const reply = await fetch(`${origin}/api/telegram/run-scheduled?action=guest-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const data = await reply.json();
  if (!reply.ok || !data.token) throw new Error(`Guest ${label} failed: HTTP ${reply.status}`);
  const app = initializeApp(config, `profile-file-smoke-${label}-${randomUUID()}`);
  const auth = getAuth(app);
  await signInWithCustomToken(auth, data.token);
  const account = { app, auth, db: getFirestore(app, process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID) };
  users.push(account);
  return account;
}
async function api(account, action, method = 'GET', body = undefined) {
  const token = await account.auth.currentUser.getIdToken();
  const params = new URLSearchParams({ profileFiles: '1', action });
  if (body?.fileId && method !== 'POST') params.set('fileId', body.fileId);
  const response = await fetch(`${origin}/api/ai?${params}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
try {
  const a = await guest('a');
  owner = a;
  const b = await guest('b');
  const prepared = await api(a, 'auth', 'POST');
  if (prepared.status !== 200) throw new Error(`Upload auth failed: HTTP ${prepared.status}`);
  const auth = prepared.data;
  const form = new FormData();
  form.set('file', new Blob(['Company A serves jasmine tea.'], { type: 'text/plain' }), 'company-a-intro.txt');
  for (const [key, value] of Object.entries({
    fileName: 'company-a-intro.txt', publicKey: auth.publicKey, token: auth.token,
    expire: String(auth.expire), signature: auth.signature, folder: auth.folder,
    isPrivateFile: 'true', useUniqueFileName: 'true',
  })) form.set(key, value);
  const upload = await fetch(auth.uploadUrl, { method: 'POST', body: form });
  const uploaded = await upload.json();
  if (!upload.ok || !uploaded.fileId) throw new Error(`ImageKit upload failed: HTTP ${upload.status}, ${String(uploaded.message || '').replaceAll(auth.token, '[token]').replaceAll(auth.signature, '[signature]').slice(0, 200)}`);
  uploadedId = uploaded.fileId;
  const finalized = await api(a, 'finalize', 'POST', { fileId: uploadedId, name: 'company-a-intro.txt' });
  if (finalized.status !== 200) throw new Error(`Finalization failed: HTTP ${finalized.status}, ${finalized.data.error || ''}`);
  const crossFinalize = await api(b, 'finalize', 'POST', { fileId: uploadedId, name: 'company-a-intro.txt' });
  if (crossFinalize.status !== 403) throw new Error(`Cross-company finalize returned HTTP ${crossFinalize.status}`);
  const extracted = await api(a, 'extract', 'POST', { fileId: uploadedId });
  if (extracted.status !== 200 || !extracted.data.businessDocumentKnowledge?.includes('jasmine tea')) throw new Error(`Knowledge extraction failed: HTTP ${extracted.status}, ${extracted.data.error || ''}`);
  const aList = await api(a, 'list');
  const bList = await api(b, 'list');
  if (!aList.data.files?.some((file) => file.id === uploadedId) || bList.data.files?.some((file) => file.id === uploadedId)) throw new Error('Account lists mixed company files.');
  const aDownload = await api(a, 'download', 'GET', { fileId: uploadedId });
  const bDownload = await api(b, 'download', 'GET', { fileId: uploadedId });
  if (aDownload.status !== 200 || bDownload.status !== 404) throw new Error('Download access check failed.');
  const saved = await getDoc(doc(a.db, 'business_profiles', a.auth.currentUser.uid));
  if (!saved.data()?.businessDocumentKnowledge?.includes('jasmine tea')) throw new Error('Agent knowledge was not saved to the owner profile.');
  console.log('PASS: production guest A uploaded, saved, extracted, listed and downloaded; guest B was denied and saw no file.');
} finally {
  if (uploadedId) {
    const removedThroughApp = owner ? await api(owner, 'delete', 'DELETE', { fileId: uploadedId }).catch(() => null) : null;
    if (removedThroughApp?.status === 200) console.log('Test file and metadata deleted.');
    else {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    const removed = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(uploadedId)}`, {
      method: 'DELETE', headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
    }).catch(() => null);
    console.log(removed?.ok ? 'Test file deleted; metadata cleanup may need checking.' : 'Test file cleanup needs checking.');
    }
  }
  for (const account of users) {
    try { await initFirebaseAdmin().collection('business_profiles').doc(account.auth.currentUser.uid).delete(); } catch { /* no profile to delete */ }
    try { await signOut(account.auth); await deleteApp(account.app); } catch { /* process exits */ }
  }
}
