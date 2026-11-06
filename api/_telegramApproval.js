import { FieldValue } from 'firebase-admin/firestore';

const isDue = (post) => new Date(post.scheduledTime).getTime() <= Date.now() + 1000;
const validId = (value) => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));

export async function botCall(method, payload, token) {
  if (!token) throw new Error('Approval bot is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed.`);
  return data.result;
}

export async function approvalNeeded(db, ref) {
  const snap = await ref.get();
  const post = snap.data();
  if (!post || !['PENDING', 'AWAITING_APPROVAL'].includes(post.status) || post.approvalRequired !== true || post.approvalStatus === 'APPROVED') return false;
  if (isDue(post)) await ensureApprovalRequest(db, ref, post);
  return true;
}

export async function ensureApprovalRequest(db, ref, knownPost) {
  if (ref.parent?.id !== 'scheduled_posts') return false;
  const post = knownPost || (await ref.get()).data();
  if (!post || !['PENDING', 'AWAITING_APPROVAL'].includes(post.status) || post.approvalRequired !== true || !isDue(post)) return false;
  if (post.approvalStatus === 'APPROVED' || post.approvalStatus === 'REJECTED') return false;
  if (post.sourcePlanItemId) {
    const source = await db.collection('content_plan_items').doc(post.sourcePlanItemId).get();
    if (!source.exists || source.data()?.userId !== post.userId || source.data()?.supersededBy || source.data()?.status === 'CANCELLED') {
      await ref.update({ status: 'CANCELLED', cancelledReason: 'Content Plan was replaced.' });
      return false;
    }
  }
  const link = (await db.collection('telegram_approval_links').doc(post.userId).get()).data();
  if (!link?.chatId || !link?.telegramUserId) {
    if (post.approvalStatus !== 'AWAITING_LINK' || post.status !== 'AWAITING_APPROVAL') await ref.update({ status: 'AWAITING_APPROVAL', approvalStatus: 'AWAITING_LINK' });
    return false;
  }
  const botOwnerId = String(link.botOwnerId || post.userId);
  if (link.botOwnerId) {
    const chatBinding = (await db.collection('telegram_approval_chats').doc(`${botOwnerId}_${link.telegramUserId}`).get()).data();
    if (!chatBinding || chatBinding.uid !== post.userId || String(chatBinding.chatId) !== String(link.chatId)) {
      await ref.update({ status: 'AWAITING_APPROVAL', approvalStatus: 'AWAITING_LINK' });
      return false;
    }
  }
  const profile = (await db.collection('business_profiles').doc(botOwnerId).get()).data() || {};
  if (String(profile.telegramBotUsername || '').toLowerCase() === 'dgacademy_official_bot' && !link.botOwnerId) {
    await ref.update({ status: 'AWAITING_APPROVAL', approvalStatus: 'AWAITING_LINK' });
    return false;
  }
  const botToken = String(profile.telegramBotToken || '').trim();
  if (!botToken || profile.telegramBotActive !== true) {
    await ref.update({ status: 'AWAITING_APPROVAL', approvalStatus: 'SEND_FAILED', approvalError: 'Owner bot is not active.', nextApprovalRetryAt: Date.now() + 10 * 60_000 });
    return false;
  }
  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const data = fresh.data();
    const started = data?.approvalRequestStartedAt?.toMillis?.() || 0;
    if (!data || !['PENDING', 'AWAITING_APPROVAL'].includes(data.status) || data.approvalRequired !== true || data.approvalStatus === 'APPROVED' || data.approvalStatus === 'REJECTED' || (data.approvalStatus === 'REQUESTED' && String(data.approvalTelegramUserId) === String(link.telegramUserId)) || (data.approvalStatus === 'REQUESTING' && Date.now() - started < 5 * 60_000)) return false;
    tx.update(ref, { status: 'AWAITING_APPROVAL', approvalStatus: 'REQUESTING', approvalRequestStartedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return false;
  const media = String(post.videoUrl || post.mediaUrl || '').trim();
  const preview = [`Do you accept this content to post to ${post.platform}?`, '', String(post.content || '').slice(0, 2500), ...(media ? ['', `Media: ${media}`] : [])].join('\n').slice(0, 3900);
  try {
    const message = await botCall('sendMessage', {
      chat_id: link.chatId, text: preview,
      reply_markup: { inline_keyboard: [[
        { text: 'Yes', callback_data: `ap:y:${ref.id}` },
        { text: 'No', callback_data: `ap:n:${ref.id}` },
      ]] },
    }, botToken);
    await ref.update({ approvalStatus: 'REQUESTED', approvalMessageId: message.message_id, approvalChatId: String(link.chatId), approvalTelegramUserId: String(link.telegramUserId), approvalRequestedAt: FieldValue.serverTimestamp() });
    return true;
  } catch (error) {
    await ref.update({ approvalStatus: 'SEND_FAILED', approvalError: String(error?.message || 'Could not send approval request.').slice(0, 300), nextApprovalRetryAt: Date.now() + 10 * 60_000 });
    return false;
  }
}

export async function sendDueApprovalsForUser(db, uid) {
  const snapshot = await db.collection('scheduled_posts').where('userId', '==', uid).get();
  for (const doc of snapshot.docs) {
    const post = doc.data();
    if (post.approvalRequired === true && ['PENDING', 'AWAITING_APPROVAL'].includes(post.status) && post.approvalStatus !== 'APPROVED' && isDue(post)) {
      await ensureApprovalRequest(db, doc.ref, post);
    }
  }
}

export async function decideApproval(db, callback, botOwnerId) {
  const match = String(callback?.data || '').match(/^ap:([yn]):([A-Za-z0-9_-]{1,128})$/);
  if (!match || !validId(match[2])) return { ok: false, text: 'Invalid approval button.' };
  const [, choice, postId] = match;
  const actorId = String(callback.from?.id || '');
  const chatId = String(callback.message?.chat?.id || '');
  const messageId = callback.message?.message_id;
  const binding = (await db.collection('telegram_approval_chats').doc(`${botOwnerId}_${actorId}`).get()).data();
  if (!binding || String(binding.chatId) !== chatId || (binding.botOwnerId || binding.uid) !== botOwnerId) return { ok: false, text: 'Sign in to this bot again.' };
  if (binding.botOwnerId) {
    const link = (await db.collection('telegram_approval_links').doc(binding.uid).get()).data();
    if (!link || link.botOwnerId !== botOwnerId || String(link.chatId) !== chatId || String(link.telegramUserId) !== actorId) {
      return { ok: false, text: 'Sign in to this bot again.' };
    }
  }
  const ref = db.collection('scheduled_posts').doc(postId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const post = snap.data();
    if (!post || post.userId !== binding.uid || post.approvalRequired !== true || post.status !== 'AWAITING_APPROVAL' || post.approvalStatus !== 'REQUESTED' || String(post.approvalChatId) !== chatId || String(post.approvalTelegramUserId) !== actorId || post.approvalMessageId !== messageId) return { ok: false, text: 'This request is no longer pending.' };
    if (post.sourcePlanItemId) {
      const source = await tx.get(db.collection('content_plan_items').doc(post.sourcePlanItemId));
      if (!source.exists || source.data()?.userId !== post.userId || source.data()?.supersededBy || source.data()?.status === 'CANCELLED') {
        tx.update(ref, { status: 'CANCELLED', cancelledReason: 'Content Plan was replaced.' });
        return { ok: false, text: 'This Content Plan was replaced.' };
      }
    }
    tx.update(ref, choice === 'y'
      ? { status: 'PENDING', approvalStatus: 'APPROVED', approvedAt: FieldValue.serverTimestamp(), approvedByTelegramUserId: actorId }
      : { approvalStatus: 'REJECTED', status: 'CANCELLED', rejectedAt: FieldValue.serverTimestamp(), rejectedByTelegramUserId: actorId });
    return { ok: true, approved: choice === 'y', postId, platform: post.platform, scheduledTime: post.scheduledTime, text: choice === 'y' ? 'Approved. Publishing now.' : 'Rejected. This post will not publish.' };
  });
  return result;
}
