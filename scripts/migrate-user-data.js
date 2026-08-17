// One-off CLI to re-assign a user's Firestore data from one uid to another --
// built for the case where someone used the app as a Guest (data tagged with
// a guest_device_... uid, scoped to one browser/device) and later wants that
// same data to show up under their real signed-in account (a different uid),
// which needs a real re-write since Firestore rules require incoming().userId
// to match request.auth.uid on every write, and a normal client can never
// write a doc under someone else's uid.
//
// Usage:
//   node scripts/migrate-user-data.js <from-uid-or-email> <to-uid-or-email>            # dry run, no writes
//   node scripts/migrate-user-data.js <from-uid-or-email> <to-uid-or-email> --confirm   # actually migrate
//
// Needs the same server-side Firebase Admin credentials as the Vercel
// functions: FIREBASE_PROJECT_ID (+ FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
// or Application Default Credentials) in .env or the environment.

import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

const initFirebaseAdmin = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured (check .env).');
  }

  const app = clientEmail && privateKey
    ? admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }), projectId })
    : admin.initializeApp({ projectId });

  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
};

const resolveUid = async (identifier) => {
  if (!identifier.includes('@')) return identifier;
  const user = await admin.auth().getUserByEmail(identifier);
  return user.uid;
};

// Collections where documents just have a userId field alongside an
// auto-generated doc ID -- reassigning ownership is a plain field update.
const FIELD_COLLECTIONS = ['scheduled_posts', 'campaigns', 'reply_rules', 'audience_activity'];

// Collections where the doc ID itself IS the uid (one doc per user) -- moving
// ownership means copying the doc under the new ID and removing the old one,
// not just updating a field.
const KEYED_COLLECTIONS = ['business_profiles', 'agent_conversations'];

const migrateFieldCollection = async (db, name, fromUid, toUid, confirm) => {
  const snapshot = await db.collection(name).where('userId', '==', fromUid).get();
  console.log(`${name}: ${snapshot.size} document(s) found for ${fromUid}`);
  if (!confirm || snapshot.empty) return snapshot.size;

  for (const doc of snapshot.docs) {
    await doc.ref.update({ userId: toUid });
    console.log(`  updated ${name}/${doc.id}`);
  }
  return snapshot.size;
};

const migrateKeyedCollection = async (db, name, fromUid, toUid, confirm) => {
  const oldRef = db.collection(name).doc(fromUid);
  const oldSnap = await oldRef.get();
  if (!oldSnap.exists) {
    console.log(`${name}: no document at ${fromUid}`);
    return 0;
  }

  const newRef = db.collection(name).doc(toUid);
  const newSnap = await newRef.get();
  if (newSnap.exists) {
    console.log(`${name}: SKIPPED -- a document already exists at ${toUid}. Resolve this one manually (merge by hand in the Firebase console) so nothing gets silently overwritten.`);
    return 0;
  }

  console.log(`${name}: 1 document found for ${fromUid}`);
  if (!confirm) return 1;

  const data = oldSnap.data();
  await newRef.set({ ...data, userId: toUid, migratedFrom: fromUid, migratedAt: FieldValue.serverTimestamp() });
  await oldRef.delete();
  console.log(`  moved ${name}/${fromUid} -> ${name}/${toUid}`);
  return 1;
};

const main = async () => {
  const args = process.argv.slice(2).filter((a) => a !== '--confirm');
  const confirm = process.argv.includes('--confirm');
  const [fromIdentifier, toIdentifier] = args;

  if (!fromIdentifier || !toIdentifier) {
    console.error('Usage: node scripts/migrate-user-data.js <from-uid-or-email> <to-uid-or-email> [--confirm]');
    process.exit(1);
  }

  const db = initFirebaseAdmin();
  const fromUid = await resolveUid(fromIdentifier);
  const toUid = await resolveUid(toIdentifier);

  if (fromUid === toUid) {
    console.error('from and to resolved to the same uid -- nothing to do.');
    process.exit(1);
  }

  console.log(`Migrating data from ${fromUid} (${fromIdentifier}) to ${toUid} (${toIdentifier})`);
  console.log(confirm ? '*** LIVE RUN -- this will write/delete data ***' : 'Dry run (no changes will be made) -- pass --confirm to actually migrate');
  console.log('');

  let total = 0;
  for (const name of FIELD_COLLECTIONS) {
    total += await migrateFieldCollection(db, name, fromUid, toUid, confirm);
  }
  for (const name of KEYED_COLLECTIONS) {
    total += await migrateKeyedCollection(db, name, fromUid, toUid, confirm);
  }

  console.log('');
  console.log(confirm
    ? `Done. ${total} document(s) migrated.`
    : `Dry run complete. ${total} document(s) would be migrated -- re-run with --confirm to apply.`);

  process.exit(0);
};

main().catch((error) => {
  console.error('migrate-user-data failed:', error?.message || error);
  process.exit(1);
});
