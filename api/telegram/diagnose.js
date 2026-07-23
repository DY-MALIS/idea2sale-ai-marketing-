import { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  const report = {
    hasTelegramBotToken: !!(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    hasTelegramChatId: !!(process.env.TELEGRAM_CHAT_ID || '').trim(),
    hasFirebaseProjectId: !!(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
    hasFirebaseClientEmail: !!(process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    hasFirebasePrivateKey: !!(process.env.FIREBASE_PRIVATE_KEY || '').trim(),
    firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '(default)',
  };

  try {
    const db = initFirebaseAdmin();
    report.firebaseAdminInit = 'ok';

    try {
      const testRef = db.collection('telegram_leads').doc('__diagnose_test__');
      await testRef.set({ diagnosedAt: FieldValue.serverTimestamp() });
      const snap = await testRef.get();
      report.firestoreWrite = snap.exists ? 'ok' : 'wrote but not found on read-back';
      await testRef.delete();
    } catch (writeError) {
      report.firestoreWrite = 'FAILED';
      report.firestoreWriteError = writeError?.message || String(writeError);
    }
  } catch (initError) {
    report.firebaseAdminInit = 'FAILED';
    report.firebaseAdminInitError = initError?.message || String(initError);
  }

  return res.status(200).json(report);
}
