import { FieldValue } from 'firebase-admin/firestore';

// Atomically claims a scheduled post for delivery: reads the doc, and only if
// it is still PENDING, flips it to PROCESSING in the same transaction. Used by
// both api/telegram/deliver.js (QStash webhook) and api/telegram/run-scheduled.js
// (cron poller) — both can race to deliver the same post around its due time,
// and a plain get()-then-update() has a window where both see "PENDING" and
// both publish to Telegram. The transaction makes the claim compare-and-swap
// so only one caller ever wins it.
export async function claimPendingPost(db, ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { skipped: 'not_found' };
    const data = { id: snap.id, ...snap.data() };
    if (data.status !== 'PENDING') return { skipped: data.status };
    tx.update(ref, { status: 'PROCESSING', processingAt: FieldValue.serverTimestamp() });
    return { post: data };
  });
}

// Second, cross-document safety net: the atomic claim above only stops the
// *same* scheduled_posts doc from being sent twice. It can't stop two
// *different* docs that ended up holding the same media -- e.g. a
// double-submitted schedule form, or a client retry after a network error
// that actually reached the server. Both docs independently claim fine and
// each publishes, so the same video/photo goes out to Telegram twice. Equality-
// only filters (platform/mediaUrl/status) need no composite index.
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

export async function findRecentDuplicateTelegramPost(db, post) {
  return findRecentDuplicatePost(db, 'TELEGRAM', post.id, 'mediaUrl', post?.mediaUrl);
}

// Same cross-document safety net, for TikTok's scheduled_posts docs (see
// runTikTokCron in api/tiktok/publish.js) -- a double-submitted Smart Scheduler
// form there is just as capable of creating two separate PENDING docs for the
// same video, and claimPendingPost alone can't stop two *different* docs from
// each independently publishing it. TikTok posts store the video under
// `videoUrl` (see SchedulerHub.tsx), not `mediaUrl`.
export async function findRecentDuplicateTikTokPost(db, post) {
  return findRecentDuplicatePost(db, 'TIKTOK', post.id, 'videoUrl', post?.videoUrl);
}

async function findRecentDuplicatePost(db, platform, postId, urlField, url) {
  url = String(url || '').trim();
  if (!url) return null;

  const snapshot = await db
    .collection('scheduled_posts')
    .where('platform', '==', platform)
    .where(urlField, '==', url)
    .where('status', '==', 'PUBLISHED')
    .get();

  const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
  const match = snapshot.docs.find((docSnap) => {
    if (docSnap.id === postId) return false;
    const publishedAtMs = docSnap.data()?.publishedAt?.toMillis?.();
    return typeof publishedAtMs === 'number' && publishedAtMs >= cutoff;
  });

  return match ? match.id : null;
}
