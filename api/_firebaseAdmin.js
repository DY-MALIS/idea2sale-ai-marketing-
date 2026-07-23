import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export const initFirebaseAdmin = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not configured.');
  }

  if (admin.apps.length) {
    const app = admin.app();
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }

  let app;
  if (clientEmail && privateKey) {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  } else {
    app = admin.initializeApp({ projectId });
  }

  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
};

export default admin;
