import { getFacebookPages, scheduleFacebookQStashDelivery } from './_facebook.js';
import { scheduleYouTubeQStashDelivery } from './_youtube.js';
import { scheduleTikTokQStashDelivery } from './_tiktok.js';
import { scheduleQStashDelivery } from './telegram/run-scheduled.js';

// Queue each destination once. The platform pollers own the actual upload and
// its final status in Content Timeline. A stale video callback cannot create
// posts after its plan item has been replaced.
export async function queueContentPlanDestinations(db, itemId, mediaUrl, req) {
  const itemRef = db.collection('content_plan_items').doc(itemId);
  const itemSnap = await itemRef.get();
  const item = itemSnap.data();
  if (!item || item.supersededBy || item.status !== 'PROCESSING') return { skipped: 'inactive', queued: [] };
  if (item.autoPublishDestinations !== true) return { skipped: 'not_enabled', queued: [] };
  if (item.type === 'video' && item.speechVerification?.passed !== true) return { skipped: 'speech_not_verified', queued: [] };
  if (item.type === 'video' && item.imageFallbackReason) return { skipped: 'visual_review_required', queued: [] };

  const isVideo = item.type === 'video';
  const targets = isVideo
    ? (item.approvalRequired === true ? ['TELEGRAM', 'YOUTUBE', 'FACEBOOK', 'TIKTOK'] : ['YOUTUBE', 'FACEBOOK', 'TIKTOK'])
    : (item.approvalRequired === true ? ['TELEGRAM', 'FACEBOOK'] : ['FACEBOOK']);
  const connection = await getFacebookPages(db, item.userId).catch(() => null);
  const facebookPageId = connection?.selectedPageId || connection?.pages?.[0]?.id;
  const queued = [];
  const skipped = [];
  if (item.approvalRequired === true) {
    // Cron may see the Telegram post while the remaining destinations are
    // still being created. No prompt may leave until the group is complete.
    await itemRef.update({ approvalFanoutReady: false });
  }
  const deliveryJobs = [];
  for (const platform of targets) {
    if (platform === 'FACEBOOK' && !facebookPageId) { skipped.push('FACEBOOK: no connected Page'); continue; }
    if (platform === 'TIKTOK' && item.tiktokDirectPostConsent !== true) { skipped.push('TIKTOK: consent missing'); continue; }
    const ref = db.collection('scheduled_posts').doc(`plan-${itemId}-${platform.toLowerCase()}`);
    const scheduledTime = new Date().toISOString();
    const data = {
      userId: item.userId,
      content: String(item.topic || '').slice(0, 2000),
      platform,
      groupId: `plan-${itemId}`,
      sourcePlanItemId: itemId,
      scheduledTime,
      status: 'PENDING',
      ...(item.approvalRequired === true ? { approvalRequired: true, approvalStatus: 'AWAITING_DUE' } : {}),
      aiSuggested: true,
      videoUrl: isVideo && platform !== 'TELEGRAM' ? mediaUrl : '',
      mediaUrl: platform === 'TELEGRAM' || !isVideo ? mediaUrl : '',
      mediaType: isVideo ? 'video' : 'photo',
      ...(platform === 'FACEBOOK' ? { facebookPageId: String(facebookPageId) } : {}),
      publishMode: platform === 'TELEGRAM' ? 'TELEGRAM_AUTO_POST' : platform === 'FACEBOOK'
        ? (isVideo ? 'FACEBOOK_REEL_AUTO_POST' : 'FACEBOOK_PHOTO_AUTO_POST')
        : platform === 'YOUTUBE' ? 'YOUTUBE_AUTO_POST' : 'TIKTOK_DIRECT_POST',
      ...(platform === 'YOUTUBE' ? { youtubeRequestedPrivacyStatus: 'public' } : {}),
      ...(platform === 'TIKTOK' ? { directPostOptions: {
        consent: true,
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        durationSeconds: Number(item.duration) || 8,
        aiGenerated: true,
        allowComment: true,
        allowDuet: false,
        allowStitch: false,
        commercialDisclosure: item.tiktokCommercialDisclosure === true,
        ownBrand: item.tiktokOwnBrand === true,
        brandedContent: item.tiktokBrandedContent === true,
      } } : {}),
      createdAt: new Date(),
    };
    const creation = await db.runTransaction(async (tx) => {
      const [freshItem, existing] = await Promise.all([tx.get(itemRef), tx.get(ref)]);
      if (freshItem.data()?.supersededBy || freshItem.data()?.status !== 'PROCESSING') return 'inactive';
      if (isVideo && freshItem.data()?.speechVerification?.passed !== true) return 'inactive';
      if (existing.exists) {
        const previous = existing.data();
        return previous?.userId === item.userId && previous?.groupId === `plan-${itemId}`
          && previous?.content === data.content && previous?.platform === platform
          && String(previous?.videoUrl || previous?.mediaUrl || '') === mediaUrl
          && !['PUBLISHED', 'CANCELLED'].includes(previous?.status) ? 'existing' : 'conflict';
      }
      tx.create(ref, data);
      return 'created';
    });
    if (creation === 'inactive') return { skipped: 'inactive', queued };
    if (creation === 'conflict') throw new Error(`Content Plan ${platform} destination conflicts with existing media; review the item before retrying.`);
    if (creation === 'created') queued.push(platform);
    // An interrupted fanout may have created some deterministic posts already.
    // Re-arm those jobs as well when a later invocation completes the group.
    deliveryJobs.push({ platform, postId: ref.id });
  }
  if (item.approvalRequired === true) {
    const fresh = await itemRef.get();
    if (!fresh.exists || fresh.data()?.status !== 'PROCESSING' || fresh.data()?.supersededBy) return { skipped: 'inactive', queued };
    await itemRef.update({ approvalFanoutReady: true });
  }
  for (const { platform, postId } of deliveryJobs) {
    try {
      if (platform === 'TELEGRAM') await scheduleQStashDelivery(req, postId, new Date());
      else if (platform === 'YOUTUBE') await scheduleYouTubeQStashDelivery(req, postId, new Date());
      else if (platform === 'FACEBOOK') await scheduleFacebookQStashDelivery(postId, new Date());
      else await scheduleTikTokQStashDelivery(req, postId, new Date());
    } catch (error) {
      // The platform's cron remains the delivery fallback.
      console.warn(`Content Plan ${platform} precise delivery deferred:`, error?.message || error);
    }
  }
  return { queued, skipped };
}
