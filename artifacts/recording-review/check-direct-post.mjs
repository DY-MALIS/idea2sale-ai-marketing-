import 'dotenv/config';
import { initFirebaseAdmin } from '../../api/_firebaseAdmin.js';
import { getAutomationAccessToken } from '../../api/_tiktok.js';

const db = initFirebaseAdmin();
const post = await db.collection('scheduled_posts').doc('vHQy49Jd9SZgBKd662An').get();
if (!post.exists) throw new Error('Reference scheduled post is unavailable.');
const ownerId = post.data().userId;
const stored = await db.collection('tiktok_automation_tokens').doc(ownerId).get();
const token = await getAutomationAccessToken(db, ownerId);
const response = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
  body: '{}',
});
const data = await response.json();
console.log(JSON.stringify({
  configuredScopes: (process.env.TIKTOK_SCOPES || '').split(',').map(scope => scope.trim()),
  connected: Boolean(token),
  storedScope: stored.data()?.scope || null,
  httpStatus: response.status,
  apiCode: data.error?.code || null,
  privacyOptions: data.data?.privacy_level_options || [],
  maxDuration: data.data?.max_video_post_duration_sec || null,
  creatorIsPrivate: data.data?.is_private_account ?? null,
}));
