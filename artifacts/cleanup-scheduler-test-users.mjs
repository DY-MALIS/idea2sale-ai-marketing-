import dotenv from 'dotenv';
import admin, { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
initFirebaseAdmin();
let count = 0;
let next;
do {
  const page = await admin.auth().listUsers(1000, next);
  for (const user of page.users) {
    if (user.uid.startsWith('codex_scheduler_')) {
      await admin.auth().deleteUser(user.uid);
      count++;
    }
  }
  next = page.pageToken;
} while (next);
process.stdout.write(`${JSON.stringify({ remainingTestAccountsRemoved: count })}\n`);
