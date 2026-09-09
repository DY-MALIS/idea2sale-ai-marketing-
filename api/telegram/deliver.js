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
    const wantsNarration = ['gemini', 'separate'].includes(item.voiceOverMode) && item.voiceOverWanted !== false && item.prompt
      && !wantsSilentVideo(item.prompt);
    if (wantsNarration) {
      const script = item.voiceOverText || await createKhmerNarration(item.prompt, 8);
      let narration = item.narrationAudio;
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
    if (item.voiceOverWanted !== false && item.voiceOverMode !== 'silent' && item.prompt && !wantsSilentVideo(item.prompt)) {
      await ref.update({ resultMediaUrl: uploaded.mediaUrl });
      try {
        const speechVerification = await verifyUploadedVideoSpeech(uploaded.mediaUrl, item.voiceOverText);
        await ref.update({ speechVerification });
      } catch (verifyError) {
        const speechVerification = verifyError?.speechVerification || { passed: false };
        await ref.update({ speechVerification });
        await notifyAdmins(`Content plan video item ${itemId}: Khmer speech verification needs review; sending to Telegram as scheduled: ${verifyError?.message || 'unknown error'}`);
      }
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
      const messageId = await sendTelegram(post, db);
      await ref.update({
        status: 'PUBLISHED',
        telegramMessageId: messageId,
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
