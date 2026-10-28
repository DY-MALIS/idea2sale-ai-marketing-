import { getFacebookPages, scheduleFacebookQStashDelivery } from './_facebook.js';
import { scheduleYouTubeQStashDelivery } from './_youtube.js';
import { scheduleTikTokQStashDelivery } from './_tiktok.js';

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
  const targets = isVideo ? ['YOUTUBE', 'FACEBOOK', 'TIKTOK'] : ['FACEBOOK'];
  const connection = await getFacebookPages(db, item.userId).catch(() => null);
  const facebookPageId = connection?.selectedPageId || connection?.pages?.[0]?.id;
  const queued = [];
  const skipped = [];
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
      aiSuggested: true,
      videoUrl: isVideo ? mediaUrl : '',
      mediaUrl: isVideo ? '' : mediaUrl,
      mediaType: isVideo ? 'video' : 'photo',
      ...(platform === 'FACEBOOK' ? { facebookPageId: String(facebookPageId) } : {}),
      publishMode: platform === 'FACEBOOK'
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
    const created = await db.runTransaction(async (tx) => {
      const [freshItem, existing] = await Promise.all([tx.get(itemRef), tx.get(ref)]);
      if (existing.exists || freshItem.data()?.supersededBy || freshItem.data()?.status !== 'PROCESSING') return false;
      if (isVideo && freshItem.data()?.speechVerification?.passed !== true) return false;
      tx.create(ref, data);
      return true;
    });
    if (!created) continue;
    queued.push(platform);
    try {
      if (platform === 'YOUTUBE') await scheduleYouTubeQStashDelivery(req, ref.id, new Date());
      else if (platform === 'FACEBOOK') await scheduleFacebookQStashDelivery(ref.id, new Date());
      else await scheduleTikTokQStashDelivery(req, ref.id, new Date());
    } catch (error) {
      // The platform's cron remains the delivery fallback.
      console.warn(`Content Plan ${platform} precise delivery deferred:`, error?.message || error);
    }
  }
  return { queued, skipped };
}
