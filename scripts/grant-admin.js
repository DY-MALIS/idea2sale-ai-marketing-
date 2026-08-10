// One-off CLI to create/remove an admins/{uid} Firestore document, so granting
// admin (needed for the Telegram CRM/inbox and deleting tiktok_posts) does not
// require hand-editing Firestore in the Firebase console.
//
// Usage:
//   node scripts/grant-admin.js someone@example.com
//   node scripts/grant-admin.js <firebase-uid>
//   node scripts/grant-admin.js someone@example.com --revoke
//
// Needs the same server-side Firebase Admin credentials as the Vercel
// functions: FIREBASE_PROJECT_ID (+ FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
// or Application Default Credentials) in .env or the environment.

import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

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

const main = async () => {
  const args = process.argv.slice(2).filter((a) => a !== '--revoke');
  const revoke = process.argv.includes('--revoke');
  const identifier = args[0];

  if (!identifier) {
    console.error('Usage: node scripts/grant-admin.js <email-or-uid> [--revoke]');
    process.exit(1);
  }

  const db = initFirebaseAdmin();
  const uid = identifier.includes('@')
    ? (await admin.auth().getUserByEmail(identifier)).uid
    : identifier;

  const ref = db.collection('admins').doc(uid);

  if (revoke) {
    await ref.delete();
    console.log(`Removed admin rights for uid ${uid} (${identifier}).`);
  } else {
    await ref.set({ grantedAt: new Date().toISOString(), grantedVia: 'scripts/grant-admin.js' });
    console.log(`Granted admin rights to uid ${uid} (${identifier}).`);
  }

  process.exit(0);
};

main().catch((error) => {
  console.error('grant-admin failed:', error?.message || error);
  process.exit(1);
});
