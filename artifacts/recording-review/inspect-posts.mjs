import 'dotenv/config';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebaseAdmin } from '../../api/_firebaseAdmin.js';

const db = initFirebaseAdmin();
const from = Timestamp.fromDate(new Date('2026-10-19T04:48:00Z'));
const posts = await db.collection('scheduled_posts').where('createdAt', '>=', from).orderBy('createdAt', 'asc').limit(30).get();
for (const item of posts.docs) {
  const post = item.data();
  console.log(JSON.stringify({
    id: item.id,
    created: post.createdAt?.toDate?.()?.toISOString(),
    platform: post.platform,
    scheduledTime: post.scheduledTime,
    status: post.status,
    groupId: post.groupId,
    hasVideo: Boolean(post.videoUrl),
    errorMessage: post.errorMessage || null,
    publishedAt: post.publishedAt?.toDate?.()?.toISOString() || null,
    telegramMessageId: post.telegramMessageId || null,
    duplicateSkipped: post.duplicateSkipped || false,
    hasTelegramMessageField: Object.hasOwn(post, 'telegramMessageId'),
    hasDeliveredChatField: Object.hasOwn(post, 'deliveredChatId'),
    youtubeVideoId: post.youtubeVideoId || null,
    hasTikTokPublishId: Boolean(post.tiktokPublishId),
  }));
}
const audits = await db.collection('audit_logs')
  .where('createdAt', '>=', from).orderBy('createdAt', 'asc').limit(50).get();
for (const item of audits.docs) {
  const event = item.data();
  if (event.meta?.postId === 'naFOyd2KeoUSPVaZIpa6') {
    console.log(JSON.stringify({ audit: event.action, at: event.createdAt?.toDate?.()?.toISOString(), status: event.meta?.status }));
  }
}
