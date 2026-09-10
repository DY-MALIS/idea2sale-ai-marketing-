import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { logAudit } from '../_audit.js';
import { getCookie, getAutomationAccessToken, recordTikTokPostSync } from '../_tiktok.js';
import { claimPendingPost, findRecentDuplicateTikTokPost } from '../_telegramClaim.js';
import { notifyAdmins } from '../_alert.js';

// Best-effort: TikTok publishing is authenticated via the tiktok_token cookie
// (one shared TikTok connection for the app), not Firebase Auth, so there is
// no uid to require here. If the caller is signed in to Firebase we still
// attach their uid to the audit log; if not, the log just has no actor.
async function resolveActorUid(req) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

function videoFromDataUrl(videoUrl) {
  const match = String(videoUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1] || 'video/mp4';
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType)) {
    const error = new Error('TikTok accepts MP4, MOV, or WebM videos only.');
    // Without this, the catch-all handler below has no way to tell this apart
    // from a real server-side failure and reports it as a 500, which can mislead
    // client-side error handling/monitoring that treats 5xx as retryable/alertable.
    error.status = 400;
    error.code = 'unsupported_video_type';
    throw error;
  }

  return {
    mimeType,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

async function tiktokJson(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  const apiError = data?.error;
  if (!response.ok || (apiError?.code && apiError.code !== 'ok')) {
    const message = apiError?.message || data?.message || `TikTok request failed with ${response.status}`;
    const code = apiError?.code || data?.code || 'tiktok_error';
    const error = new Error(message);
    error.status = response.status || 500;
    error.code = code;
    throw error;
  }

  return data;
}

async function uploadVideo(uploadUrl, token, video) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': video.mimeType,
      'Content-Length': String(video.buffer.length),
      'Content-Range': `bytes 0-${video.buffer.length - 1}/${video.buffer.length}`,
    },
    body: video.buffer,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `TikTok upload failed with ${response.status}`);
  }
}

function publicUrlRequest(videoUrl) {
  return /^https:\/\//i.test(String(videoUrl || ''));
}

// Shared by the manual "Publish to TikTok" button (handlePublishRequest, cookie
// token) and the cron auto-publisher (runTikTokCron, stored automation token) --
// a data: URL only ever comes from the manual path (a freshly generated video
// still sitting in the browser); the cron path always passes an https:// URL
// (Firebase Storage) since scheduled videos are uploaded ahead of time.
async function publishVideoToTikTok(token, { videoUrl, title: rawTitle }) {
  const title = String(rawTitle || 'AI Generated Content').slice(0, 2200);
  const postMode = String(process.env.TIKTOK_POST_MODE || 'inbox').toLowerCase();
  const directPost = postMode === 'direct';
  const endpoint = directPost
    ? 'https://open.tiktokapis.com/v2/post/publish/video/init/'
    : 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';

  const sourceInfo = publicUrlRequest(videoUrl)
    ? { source: 'PULL_FROM_URL', video_url: videoUrl }
    : null;
  const video = sourceInfo ? null : videoFromDataUrl(videoUrl);

  if (!sourceInfo && !video) {
    const error = new Error('Generated video is missing or is not a valid MP4/MOV/WebM data URL.');
    error.status = 400;
    error.code = 'invalid_video';
    throw error;
  }

  const fileSourceInfo = video
    ? {
        source: 'FILE_UPLOAD',
        video_size: video.buffer.length,
        chunk_size: video.buffer.length,
        total_chunk_count: 1,
      }
    : sourceInfo;

  const body = directPost
    ? {
        post_info: {
          title,
          privacy_level: process.env.TIKTOK_PRIVACY_LEVEL || 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          brand_content_toggle: false,
          brand_organic_toggle: true,
          is_aigc: true,
        },
        source_info: fileSourceInfo,
      }
    : { source_info: fileSourceInfo };

  const initData = await tiktokJson(endpoint, token, body);
  const publishId = initData?.data?.publish_id;
  const uploadUrl = initData?.data?.upload_url;

  if (video && uploadUrl) {
    await uploadVideo(uploadUrl, token, video);
  }

  return { publishId, directPost, title };
}

async function handlePublishRequest(req, res) {
  const token = getCookie(req, 'tiktok_token');
  if (!token) {
    return res.status(401).json({
      error: {
        message: 'Please reconnect TikTok after adding video.upload/video.publish to TIKTOK_SCOPES.',
        code: 'not_authenticated',
      },
    });
  }

  try {
    const videoUrl = String(req.body?.videoUrl || '');
    const { publishId, directPost, title } = await publishVideoToTikTok(token, {
      videoUrl,
      title: req.body?.title,
    });

    try {
      const actorUid = await resolveActorUid(req);
      const db = initFirebaseAdmin();
      await logAudit(db, {
        action: 'tiktok_publish_video',
        actorUid,
        meta: { publishId, mode: directPost ? 'direct' : 'inbox' },
      });
      // Feeds the "Recent TikTok Syncs" widget in TikTokAnalytics.tsx, which reads
      // this collection -- server.ts (local dev) already wrote it, but this
      // production handler didn't, so every real publish was invisible there.
      await recordTikTokPostSync(db, {
        publishId,
        title,
        videoUrl,
        userId: actorUid,
        mode: directPost ? 'direct' : 'inbox',
      });
    } catch (auditError) {
      console.error('Audit log failed for tiktok_publish_video:', auditError?.message || auditError);
    }

    return res.status(200).json({
      success: true,
      publishId,
      mode: directPost ? 'direct' : 'inbox',
      message: directPost
        ? 'Video sent to TikTok for direct posting.'
        : 'Video uploaded to TikTok. Open your TikTok inbox/notification to finish editing and post.',
    });
  } catch (error) {
    const code = error.code || 'publish_failed';
    const status = error.status || (/scope/i.test(error.message || '') ? 401 : 500);
    return res.status(status).json({
      error: {
        message: error.message || 'TikTok publishing failed.',
        code,
      },
    });
  }
}

// A scheduled_posts doc that stays claimed (PROCESSING) longer than this got
// interrupted mid-upload by a prior cron invocation timing out/crashing -- once
// claimed it's no longer PENDING, so nothing would ever retry it without this.
const STALE_PROCESSING_MS = 3 * 60 * 1000;

// Auto-publishes due TikTok posts created via Smart Scheduler (SchedulerHub.tsx,
// platform TIKTOK). Unlike the manual button above, there's no browser session to
// read a cookie token from, so this uses the stored automation token (see
// getAutomationAccessToken in ../_tiktok.js) -- populated when someone connects
// TikTok via api/tiktok/callback.js. Invoked by vercel.json's cron and the
// GitHub Action fallback poller, both hitting ?action=cron.
async function runTikTokCron(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured; refusing to run the scheduled TikTok poller.');
    return res.status(500).json({ error: 'CRON_SECRET is not configured on the server.' });
  }
  const auth = req.headers.authorization || '';
  const querySecret = req.query?.secret;
  if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = initFirebaseAdmin();
  const nowIso = new Date().toISOString();

  try {
    const staleCutoff = Date.now() - STALE_PROCESSING_MS;
    const stuckSnapshot = await db.collection('scheduled_posts')
      .where('platform', '==', 'TIKTOK')
      .where('status', '==', 'PROCESSING')
      .get();
    await Promise.all(stuckSnapshot.docs.map(async (stuckDoc) => {
      const processingAtMs = stuckDoc.data()?.processingAt?.toMillis?.();
      if (typeof processingAtMs !== 'number' || processingAtMs >= staleCutoff) return;
      // Re-check inside a transaction immediately before resetting -- the run that
      // originally claimed this post can complete (-> PUBLISHED/FAILED) in the gap
      // between the snapshot read above and this write. Only reset if it's still
      // PROCESSING with the same processingAt observed, so a newer attempt's
      // outcome never gets clobbered back to PENDING.
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(stuckDoc.ref);
        const freshData = freshSnap.data();
        const freshProcessingAtMs = freshData?.processingAt?.toMillis?.();
        if (freshData?.status === 'PROCESSING' && freshProcessingAtMs === processingAtMs) {
          tx.update(stuckDoc.ref, { status: 'PENDING' });
        }
      });
    }));

    const snapshot = await db.collection('scheduled_posts')
      .where('platform', '==', 'TIKTOK')
      .where('status', '==', 'PENDING')
      .limit(25)
      .get();

    const dueDocs = snapshot.docs
      .filter((doc) => String(doc.data()?.scheduledTime || '') <= nowIso)
      .sort((a, b) => String(a.data()?.scheduledTime || '').localeCompare(String(b.data()?.scheduledTime || '')))
      .slice(0, 5); // video uploads/inits are heavy -- keep each tick small

    if (dueDocs.length === 0) {
      return res.status(200).json({ ok: true, checkedAt: nowIso, processed: 0, results: [] });
    }

    let token;
    try {
      token = await getAutomationAccessToken(db);
    } catch (error) {
      const message = error?.message || 'TikTok token refresh failed.';
      console.error('TikTok automation token refresh failed:', message);
      await notifyAdmins(`TikTok auto-publish token refresh failed: ${message}`);
      return res.status(200).json({ ok: true, checkedAt: nowIso, processed: 0, skipped: 'token_refresh_failed' });
    }

    if (!token) {
      // Nobody has connected TikTok for automation yet -- leave these posts
      // PENDING (not FAILED) so they publish the moment someone does, instead of
      // forcing a recreate of the schedule after connecting. Alert only once a
      // due post has sat unpublished for a while, not on every 10-minute poll
      // tick right after deploy before anyone has had a chance to connect yet.
      const NOT_CONNECTED_ALERT_DELAY_MS = 60 * 60 * 1000;
      const oldestDueMs = dueDocs.reduce((min, doc) => {
        const scheduledMs = Date.parse(String(doc.data()?.scheduledTime || ''));
        return Number.isFinite(scheduledMs) ? Math.min(min, scheduledMs) : min;
      }, Infinity);
      if (Number.isFinite(oldestDueMs) && Date.now() - oldestDueMs > NOT_CONNECTED_ALERT_DELAY_MS) {
        await notifyAdmins('TikTok scheduled posts are due but TikTok automation has never been connected. Connect TikTok so the cron can publish them.');
      }
      return res.status(200).json({ ok: true, checkedAt: nowIso, processed: 0, skipped: 'not_connected' });
    }

    const results = [];
    for (const doc of dueDocs) {
      const claim = await claimPendingPost(db, doc.ref);
      if (!claim.post) {
        results.push({ id: doc.id, ok: true, skipped: true });
        continue;
      }
      const post = claim.post;

      const duplicateId = await findRecentDuplicateTikTokPost(db, post);
      if (duplicateId) {
        await doc.ref.update({
          status: 'PUBLISHED',
          tiktokPublishId: null,
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
          duplicateSkipped: true,
          errorMessage: `Skipped -- duplicate of already-published post ${duplicateId}`,
        });
        results.push({ id: doc.id, ok: true, skippedDuplicate: duplicateId });
        continue;
      }

      try {
        const { publishId, directPost } = await publishVideoToTikTok(token, {
          videoUrl: post.videoUrl,
          title: post.content,
        });
        await doc.ref.update({
          status: 'PUBLISHED',
          tiktokPublishId: publishId || null,
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
          errorMessage: null,
        });
        await recordTikTokPostSync(db, {
          publishId,
          title: post.content,
          videoUrl: post.videoUrl,
          userId: post.userId,
          mode: directPost ? 'direct' : 'inbox',
        });
        results.push({ id: doc.id, ok: true, publishId });
      } catch (error) {
        const message = error?.message || 'TikTok publish failed.';
        await doc.ref.update({
          status: 'FAILED',
          errorMessage: message,
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.push({ id: doc.id, ok: false, error: message });
        await notifyAdmins(`TikTok scheduled post ${doc.id} failed (cron): ${message}`);
      }
    }

    return res.status(200).json({ ok: true, checkedAt: nowIso, processed: results.length, results });
  } catch (error) {
    const message = error?.message || 'Scheduled TikTok runner failed.';
    await notifyAdmins(`TikTok cron runner crashed: ${message}`);
    return res.status(500).json({ ok: false, error: message });
  }
}

export default async function handler(req, res) {
  if (req.query?.action === 'cron') {
    return runTikTokCron(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  return handlePublishRequest(req, res);
}
