import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import admin, { initFirebaseAdmin } from '../api/_firebaseAdmin.js';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
initFirebaseAdmin();

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const uids = [`codex_scheduler_${suffix}_a`, `codex_scheduler_${suffix}_b`];
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
const base = 'https://aime.angkorgate.ai';
const apps = [];
const results = [];

try {
  const tokens = [];
  for (const [index, uid] of uids.entries()) {
    const app = initializeApp(config, `scheduler-connect-${suffix}-${index}`);
    apps.push(app);
    const customToken = await admin.auth().createCustomToken(uid, { guest: true });
    const credential = await signInWithCustomToken(getAuth(app), customToken);
    tokens.push(await credential.user.getIdToken());
  }

  for (const [provider, path] of [
    ['tiktok', '/api/auth/tiktok'],
    ['youtube', '/api/auth/tiktok?provider=youtube'],
    ['facebook', '/api/auth/tiktok?provider=facebook'],
  ]) {
    const providerResults = [];
    for (const [index, token] of tokens.entries()) {
      const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      const cookies = response.headers.getSetCookie();
      const ownerCookie = cookies.find(cookie => cookie.startsWith(`${provider}_oauth_owner=`)) || '';
      const ownerBound = ownerCookie.includes(uids[index]);
      providerResults.push({ status: response.status, hasAuthUrl: Boolean(body.url), ownerBound, error: response.ok ? undefined : body.error });
    }
    results.push({ provider, connect: providerResults });
  }

  for (const [provider, action] of [
    ['tiktok', 'automation'],
    ['youtube', 'youtubeAutomation'],
    ['facebook', 'facebookAutomation'],
  ]) {
    const statuses = [];
    for (const token of tokens) {
      const response = await fetch(`${base}/api/tiktok/me?action=${action}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      statuses.push({ status: response.status, connected: body.connected, setupReady: body.setupReady, error: response.ok ? undefined : body.error });
    }
    results.push({ provider, status: statuses });
  }
  process.stdout.write(`${JSON.stringify({ results })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error?.message || String(error), results })}\n`);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    ...uids.map(uid => admin.auth().deleteUser(uid)),
    ...apps.map(app => deleteApp(app)),
  ]);
  const failed = cleanup.filter(item => item.status === 'rejected' && item.reason?.code !== 'auth/user-not-found').length;
  process.stdout.write(`${JSON.stringify({ cleanup: failed ? 'incomplete' : 'complete', failures: failed })}\n`);
  if (failed) process.exitCode = 1;
}
