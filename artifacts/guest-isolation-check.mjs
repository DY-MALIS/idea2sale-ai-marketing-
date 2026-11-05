import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection as firestoreCollection, query, where } from 'firebase/firestore';
import admin, { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const uids = [`codex_isolation_${suffix}_a`, `codex_isolation_${suffix}_b`];
const adminDb = initFirebaseAdmin();
const databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const apps = [];
const records = [];
const results = [];

const makeClient = async (uid, index) => {
  const app = initializeApp(config, `isolation-${suffix}-${index}`);
  apps.push(app);
  const token = await admin.auth().createCustomToken(uid, { guest: true });
  await signInWithCustomToken(getAuth(app), token);
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
};

const payloadFor = (collection, uid) => {
  const base = { userId: uid };
  switch (collection) {
    case 'business_profiles': return { ...base, businessName: `Isolation Test ${uid.slice(-1)}`, logoDataUrl: '', directory: [], messages: [], sessions: [] };
    case 'scheduled_posts': return { ...base, content: 'Isolated test draft', platform: 'TELEGRAM', scheduledTime: new Date(Date.now() + 86400000).toISOString(), status: 'PENDING' };
    case 'saved_leads': return { ownerId: uid, businessName: 'Isolation Test Lead', businessType: 'Test', recommendedService: 'Test', inboxMessage: 'Test' };
    case 'reply_rules': return { ...base, trigger: 'isolation-test', response: 'test', platform: 'TELEGRAM' };
    case 'campaigns': return { ...base, name: 'Isolation Test', platform: 'Facebook', frequency: 'Weekly', status: 'Active' };
    case 'audience_activity': return { ...base, dayOfWeek: 'Monday', hour: 10, intensity: 1 };
    case 'generation_history': return { ...base, type: 'image', title: 'Isolation Test' };
    case 'content_plan_items': return { ...base, scheduledDate: '2026-10-22', type: 'image', prompt: 'Isolation Test', topic: 'Test', status: 'PENDING' };
    default: throw new Error(`Unknown collection ${collection}`);
  }
};

try {
  const [dbA, dbB] = await Promise.all(uids.map(makeClient));
  for (const collection of ['business_profiles', 'scheduled_posts', 'saved_leads', 'reply_rules', 'campaigns', 'audience_activity', 'generation_history', 'content_plan_items']) {
    const idA = collection === 'business_profiles' ? uids[0] : `codexiso_${suffix}_a`;
    const idB = collection === 'business_profiles' ? uids[1] : `codexiso_${suffix}_b`;
    const refA = doc(dbA, collection, idA);
    const refB = doc(dbB, collection, idB);
    records.push([collection, idA], [collection, idB]);
    await setDoc(refA, payloadFor(collection, uids[0]));
    await setDoc(refB, payloadFor(collection, uids[1]));
    if (!(await getDoc(refA)).exists() || !(await getDoc(refB)).exists()) throw new Error(`${collection}: owner read failed`);
    let crossDenied = false;
    try { await getDoc(doc(dbB, collection, idA)); }
    catch (error) { crossDenied = error?.code === 'permission-denied'; }
    if (!crossDenied) throw new Error(`${collection}: cross-account read was not denied`);
    let crossWriteDenied = false;
    try { await setDoc(doc(dbB, collection, idA), payloadFor(collection, uids[1])); }
    catch (error) { crossWriteDenied = error?.code === 'permission-denied'; }
    if (!crossWriteDenied) throw new Error(`${collection}: cross-account write was not denied`);
    let listChecks = {};
    if (collection !== 'business_profiles') {
      const ownerField = collection === 'saved_leads' ? 'ownerId' : 'userId';
      const ownList = await getDocs(query(firestoreCollection(dbA, collection), where(ownerField, '==', uids[0])));
      if (!ownList.docs.some((item) => item.id === idA)) throw new Error(`${collection}: owner list failed`);
      let crossListDenied = false;
      try { await getDocs(query(firestoreCollection(dbB, collection), where(ownerField, '==', uids[0]))); }
      catch (error) { crossListDenied = error?.code === 'permission-denied'; }
      if (!crossListDenied) throw new Error(`${collection}: cross-account list was not denied`);
      listChecks = { ownList: 'pass', crossList: 'denied' };
    }
    results.push({ collection, ownWriteRead: 'pass', crossRead: 'denied', crossWrite: 'denied', ...listChecks });
  }
  const ownProfile = doc(dbA, 'business_profiles', uids[0]);
  await updateDoc(ownProfile, { businessDescription: 'Owner-only profile edit' });
  let renameDenied = false;
  try { await updateDoc(ownProfile, { businessName: 'Unrelated Company' }); }
  catch (error) { renameDenied = error?.code === 'permission-denied'; }
  if (!renameDenied) throw new Error('business_profiles: owner could relabel an established company');
  let deleteDenied = false;
  try { await deleteDoc(ownProfile); }
  catch (error) { deleteDenied = error?.code === 'permission-denied'; }
  if (!deleteDenied) throw new Error('business_profiles: owner could delete and recreate company identity');
  results.push({ collection: 'business_profiles_identity', ownFieldUpdate: 'pass', rename: 'denied', delete: 'denied' });
  for (const collection of ['telegram_leads', 'telegram_messages']) {
    const id = `codexiso_${suffix}_a`;
    records.push([collection, id]);
    await adminDb.collection(collection).doc(id).set({ ownerId: uids[0], text: 'Isolation Test' });
    if (!(await getDoc(doc(dbA, collection, id))).exists()) throw new Error(`${collection}: owner read failed`);
    let crossDenied = false;
    try { await getDoc(doc(dbB, collection, id)); }
    catch (error) { crossDenied = error?.code === 'permission-denied'; }
    if (!crossDenied) throw new Error(`${collection}: cross-account read was not denied`);
    const ownList = await getDocs(query(firestoreCollection(dbA, collection), where('ownerId', '==', uids[0])));
    if (!ownList.docs.some((item) => item.id === id)) throw new Error(`${collection}: owner list failed`);
    let crossListDenied = false;
    try { await getDocs(query(firestoreCollection(dbB, collection), where('ownerId', '==', uids[0]))); }
    catch (error) { crossListDenied = error?.code === 'permission-denied'; }
    if (!crossListDenied) throw new Error(`${collection}: cross-account list was not denied`);
    results.push({ collection, ownRead: 'pass', ownList: 'pass', crossRead: 'denied', crossList: 'denied' });
  }
  process.stdout.write(`${JSON.stringify({ result: 'pass', checks: results })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ result: 'fail', checks: results, reason: error?.message || String(error) })}\n`);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    ...records.map(([collection, id]) => adminDb.collection(collection).doc(id).delete()),
    ...uids.map((uid) => admin.auth().deleteUser(uid)),
    ...apps.map((app) => deleteApp(app)),
  ]);
  const failures = cleanup.filter((result) => result.status === 'rejected'
    && result.reason?.code !== 'auth/user-not-found');
  process.stdout.write(`${JSON.stringify({ cleanup: failures.length ? 'incomplete' : 'complete', failures: failures.length })}\n`);
  if (failures.length) process.exitCode = 1;
}
