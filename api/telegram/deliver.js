import { Receiver } from '@upstash/qstash';
import { FieldValue } from 'firebase-admin/firestore';
import {
  TELEGRAM_CAPTION_LIMIT,
  formatTelegramHtml,
  initFirebaseAdmin,
  resolveTelegramDestination,
  scheduleContentPlanPoll,
  sendTelegram,
  truncateForTelegram,
  applyCloudinaryLogoOverlay,
  uploadMediaDataUrl,
} from './run-scheduled.js';
import { pollOpenRouterVideo } from '../_openrouter.js';
import { claimPendingPost, findRecentDuplicateTelegramPost } from '../_telegramClaim.js';
import { notifyAdmins } from '../_alert.js';
import { createKhmerNarration, generateKhmerSpeech, replaceCloudinaryAudio } from '../_khmerNarration.js';
import { verifyUploadedVideoSpeech } from '../_videoSpeech.js';
import { wantsSilentVideo } from '../../shared/videoSpeech.js';

// A stuck/broken video job should not poll forever: 40 attempts at the
// default ~20s spacing is roughly 13 minutes, comfortably past how long a
// healthy Veo job takes, after which this is treated as a real failure.
const MAX_VIDEO_POLL_ATTEMPTS = 40;

// Claims the final "ready to send" step so a duplicate/late QStash delivery
// racing a still-in-flight invocation -- both read status PROCESSING at the
// top of this function, then both finish polling/uploading/verifying around
// the same time -- can't both post the same video to Telegram. A stale claim
// (the invocation that took it crashed mid-send) is abandoned after this
// window so QStash's own redelivery can still recover it, per the retry this
// function's idempotency comment already relies on.
const DELIVERY_CLAIM_STALE_MS = 2 * 60 * 1000;

const claimDelivery = async (db, ref) => db.runTransaction(async (tx) => {
  const freshSnap = await tx.get(ref);
  const freshItem = freshSnap.data();
  if (freshItem?.status !== 'PROCESSING') return false;
  const claimedAtMs = freshItem?.deliveryClaimedAt?.toMillis?.();
  if (typeof claimedAtMs === 'number' && Date.now() - claimedAtMs < DELIVERY_CLAIM_STALE_MS) return false;
  tx.update(ref, { deliveryClaimedAt: FieldValue.serverTimestamp() });
  return true;
});

export const processContentPlanVideo = async (db, itemId, req) => {
  const ref = db.collection('content_plan_items').doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, skipped: 'missing' };
  const item = snap.data();

  // Idempotency: a duplicate/late QStash delivery re-invoking this after the
  // item already finished (or was deleted/reset) must not double-process it.
  if (item.status !== 'PROCESSING' || !item.videoJobId) {
    return { ok: true, skipped: 'not-processing' };
  }

  try {
    const result = await pollOpenRouterVideo({ jobId: item.videoJobId });

    if (!result.videoUrl) {
      const attempts = (Number(item.pollAttempts) || 0) + 1;
      if (attempts >= MAX_VIDEO_POLL_ATTEMPTS) {
        throw new Error(`Video generation timed out after ${attempts} status checks.`);
      }
      await ref.update({ pollAttempts: attempts });
      await scheduleContentPlanPoll(req, itemId);
      return { ok: true, stillProcessing: true, attempts };
    }

    const uploaded = await uploadMediaDataUrl({ mediaDataUrl: result.videoUrl, mediaType: 'video' });
    if (item.voiceOverMode === 'silent' || item.voiceOverWanted === false || wantsSilentVideo(item.prompt || '')) {
      uploaded.mediaUrl = uploaded.mediaUrl.replace('/video/upload/', '/video/upload/ac_none/');
    }
    const wantsNarration = ['edge-seedance', 'gemini', 'separate'].includes(item.voiceOverMode) && item.voiceOverWanted !== false && item.prompt
      && !wantsSilentVideo(item.prompt);
    if (wantsNarration) {
      const script = item.voiceOverText || await createKhmerNarration(item.prompt, 8);
      let narration = item.narrationAudio;
      // Lip movement was generated from this exact track. Regenerating it here
      // can change word timing and break synchronization.
      if (item.voiceOverMode === 'edge-seedance' && !narration?.publicId) {
        throw new Error('Missing original Khmer reference audio. Regenerate the video to restore lip sync.');
      }
      if (!narration) {
        const audio = await generateKhmerSpeech({ input: script, voice: item.voiceGender === 'Male' ? 'onyx' : 'nova', performanceStyle: item.performanceStyle || '', context: item.prompt });
        narration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
      }
      if (!Number.isFinite(narration.duration) || narration.duration <= 0) throw new Error('Could not verify Khmer narration duration.');
      if (narration.duration > 8) throw new Error('Khmer narration exceeds 8 seconds. Shorten the dialogue and retry.');
      uploaded.mediaUrl = replaceCloudinaryAudio(uploaded.mediaUrl, narration.publicId);
      // Materialize the transformed asset before asking Telegram to download it.
      const rendered = await fetch(uploaded.mediaUrl);
      if (!rendered.ok) throw new Error('Could not render the Khmer narration video.');
      await rendered.arrayBuffer();
    }
    // Scheduled videos do not pass through the browser-side ffmpeg watermark.
    // Apply the same saved logo here through Cloudinary so every delivery path
    // uses the Business Profile branding.
    const profileSnap = await db.collection('business_profiles').doc(item.userId).get().catch(() => null);
    const logoDataUrl = String(profileSnap?.data()?.logoDataUrl || '');
    if (logoDataUrl) {
      const uploadedLogo = await uploadMediaDataUrl({ mediaDataUrl: logoDataUrl, mediaType: 'photo' });
      uploaded.mediaUrl = applyCloudinaryLogoOverlay(uploaded.mediaUrl, uploadedLogo.publicId);
    }
    if (item.voiceOverWanted !== false && item.voiceOverMode !== 'silent' && item.prompt && !wantsSilentVideo(item.prompt)) {
      await ref.update({ resultMediaUrl: uploaded.mediaUrl });
      try {
        const speechVerification = await verifyUploadedVideoSpeech(uploaded.mediaUrl, item.voiceOverText);
        await ref.update({ speechVerification });
      } catch (verifyError) {
        const speechVerification = verifyError?.speechVerification || { passed: false };
        await ref.update({ speechVerification });
        throw verifyError;
      }
    }
    // Speech verification is the automated quality gate. Once it passes, send
    // the video immediately instead of pausing in REVIEW for a manual approval.
    // A failed verification still follows the catch path below and is never
    // published.
    if (!(await claimDelivery(db, ref))) {
      return { ok: true, skipped: 'already-sending' };
    }
    const { token, chatId } = await resolveTelegramDestination(db, item.userId);
    if (!token || !chatId) {
      throw new Error('No Telegram bot/channel is connected to deliver this to. Connect one in Business Profile.');
    }

    const caption = formatTelegramHtml(truncateForTelegram(item.topic || '', TELEGRAM_CAPTION_LIMIT));
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        video: uploaded.mediaUrl,
        caption: caption || undefined,
        parse_mode: caption ? 'HTML' : undefined,
      }),
    });
    const telegramData = await telegramResponse.json().catch(() => ({}));
    if (!telegramResponse.ok || !telegramData.ok) {
      throw new Error(telegramData?.description || 'Telegram could not deliver this video.');
    }

    await ref.update({
      status: 'DONE',
      resultMediaUrl: uploaded.mediaUrl,
      deliveredChatId: chatId,
      completedAt: FieldValue.serverTimestamp(),
      errorMessage: null,
    });
    return { ok: true };
  } catch (error) {
    const message = error?.message || 'Video generation failed.';
    await ref.update({ status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp(), ...(error?.speechVerification ? { speechVerification: error.speechVerification } : {}) });
    await notifyAdmins(`Content plan video item ${itemId} failed: ${message}`);
    return { ok: false, error: message };
  }
};

export const config = {
  api: { bodyParser: false },
};

const getRawBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (currentSigningKey && nextSigningKey) {
    const signature = req.headers['upstash-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Missing QStash signature.' });
    }
    try {
      const receiver = new Receiver({ currentSigningKey, nextSigningKey });
      const isValid = await receiver.verify({ signature, body: rawBody });
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid QStash signature.' });
      }
    } catch (error) {
      return res.status(401).json({ error: error?.message || 'QStash signature verification failed.' });
    }
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  const contentPlanItemId = String(payload?.contentPlanItemId || '').trim();
  if (contentPlanItemId) {
    try {
      const db = initFirebaseAdmin();
      const result = await processContentPlanVideo(db, contentPlanItemId, req);
      return res.status(200).json(result);
    } catch (error) {
      const message = error?.message || 'Content plan video polling crashed.';
      await notifyAdmins(`Content plan video poll crashed for item ${contentPlanItemId}: ${message}`);
      return res.status(500).json({ ok: false, error: message });
    }
  }

  const postId = String(payload?.postId || '').trim();
  if (!postId) {
    return res.status(400).json({ error: 'postId or contentPlanItemId is required.' });
  }

  try {
    const db = initFirebaseAdmin();
    const ref = db.collection('scheduled_posts').doc(postId);

    const claim = await claimPendingPost(db, ref);

    if (claim.skipped) {
      return res.status(200).json({ ok: true, skipped: claim.skipped });
    }

    const post = claim.post;

    const duplicateId = await findRecentDuplicateTelegramPost(db, post);
    if (duplicateId) {
      await ref.update({
        status: 'PUBLISHED',
        telegramMessageId: null,
        publishedAt: FieldValue.serverTimestamp(),
        duplicateSkipped: true,
        errorMessage: `Skipped -- duplicate of already-published post ${duplicateId}`,
      });
      return res.status(200).json({ ok: true, skippedDuplicate: duplicateId });
    }

    try {
      const { messageId, chatId } = await sendTelegram(post, db);
      await ref.update({
        status: 'PUBLISHED',
        telegramMessageId: messageId,
        deliveredChatId: chatId,
        publishedAt: FieldValue.serverTimestamp(),
        errorMessage: null,
      });
      return res.status(200).json({ ok: true, messageId });
    } catch (error) {
      const message = error?.message || 'Telegram publish failed.';
      await ref.update({ status: 'FAILED', errorMessage: message, failedAt: FieldValue.serverTimestamp() });
      await notifyAdmins(`Telegram post ${postId} failed (QStash): ${message}`);
      return res.status(200).json({ ok: false, error: message });
    }
  } catch (error) {
    const message = error?.message || 'Delivery failed.';
    await notifyAdmins(`Telegram QStash delivery crashed for post ${postId}: ${message}`);
    return res.status(500).json({ ok: false, error: message });
  }
}
