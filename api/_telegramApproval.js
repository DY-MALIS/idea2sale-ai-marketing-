import { FieldValue } from 'firebase-admin/firestore';
import { notifyAdmins } from './_alert.js';

const isDue = (post) => new Date(post.scheduledTime).getTime() <= Date.now() + 1000;
const validId = (value) => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));

export const validContentPlanPost = (postId, post, source) => Boolean(post?.sourcePlanItemId && source
  && postId === `plan-${post.sourcePlanItemId}-${String(post.platform || '').toLowerCase()}`
  && post.groupId === `plan-${post.sourcePlanItemId}`
  && post.aiSuggested === true && post.approvalRequired === true
  && source.userId === post.userId && source.approvalRequired === true
  && source.autoPublishDestinations === true
  && ['PROCESSING', 'DONE'].includes(source.status)
  && source.resultMediaUrl
  && String(post.videoUrl || post.mediaUrl || '') === String(source.resultMediaUrl));

export async function botCall(method, payload, token) {
  if (!token) throw new Error('Approval bot is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.description || `Telegram ${method} failed.`);
    // A timeout or 5xx can occur after Telegram accepted sendMessage. Only an
    // explicit non-server error is safe to retry automatically.
    error.telegramRejected = response.status < 500 && (!response.ok || data.ok === false);
    throw error;
  }
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
  if (['APPROVED', 'REJECTED', 'SEND_UNCERTAIN', 'REQUESTING'].includes(post.approvalStatus)) return false;
  if (post.sourcePlanItemId) {
    let source = await db.collection('content_plan_items').doc(post.sourcePlanItemId).get();
    if (!source.exists && await restoreOrphanedApprovalSource(db, post)) {
      source = await db.collection('content_plan_items').doc(post.sourcePlanItemId).get();
    }
    if (!source.exists || source.data()?.supersededBy || !validContentPlanPost(ref.id, post, source.data())) {
      await ref.update({ status: 'CANCELLED', cancelledReason: 'Content Plan was replaced.' });
      return false;
    }
    if (source.data()?.approvalFanoutReady === false) return false;
    // Content Plan approval is one decision for the whole generated item.
    // The Telegram destination is the canonical request; other platform jobs
    // remain pending and are decided by its callback.
    if (post.platform !== 'TELEGRAM') return false;
    const siblings = await db.collection('scheduled_posts').where('sourcePlanItemId', '==', post.sourcePlanItemId).get();
    if (siblings.docs.some((sibling) => sibling.id !== ref.id
      && sibling.data()?.userId === post.userId && sibling.data()?.approvalStatus === 'REQUESTED'
      && sibling.data()?.status === 'AWAITING_APPROVAL')) return false;
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
    const source = data?.sourcePlanItemId
      ? await tx.get(db.collection('content_plan_items').doc(data.sourcePlanItemId)) : null;
    if (!data || !['PENDING', 'AWAITING_APPROVAL'].includes(data.status) || data.approvalRequired !== true
      || ['APPROVED', 'REJECTED', 'REQUESTING', 'SEND_UNCERTAIN'].includes(data.approvalStatus)
      || (data.approvalStatus === 'REQUESTED' && String(data.approvalTelegramUserId) === String(link.telegramUserId))
      || (source && (source.data()?.supersededBy || !validContentPlanPost(ref.id, data, source.data())))) return false;
    tx.update(ref, { status: 'AWAITING_APPROVAL', approvalStatus: 'REQUESTING', approvalRequestStartedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return false;
  const media = String(post.videoUrl || post.mediaUrl || '').trim();
  const destinations = post.sourcePlanItemId
    ? (await db.collection('scheduled_posts').where('sourcePlanItemId', '==', post.sourcePlanItemId).get()).docs
      .filter((doc) => doc.data()?.userId === post.userId && doc.data()?.groupId === post.groupId)
      .map((doc) => doc.data().platform)
    : [];
  const question = post.sourcePlanItemId
    ? `Approve this Content Plan item for ${destinations.join(', ') || 'its connected destinations'}?`
    : `Do you accept this content to post to ${post.platform}?`;
  const preview = [question, '', String(post.content || '').slice(0, 2500), ...(media ? ['', `Media: ${media}`] : [])].join('\n').slice(0, 3900);
  let message;
  try {
    message = await botCall('sendMessage', {
      chat_id: link.chatId, text: preview,
      reply_markup: { inline_keyboard: [[
        { text: 'Yes', callback_data: `ap:y:${ref.id}` },
        { text: 'No', callback_data: `ap:n:${ref.id}` },
      ]] },
    }, botToken);
  } catch (error) {
    await ref.update(error?.telegramRejected
      ? { approvalStatus: 'SEND_FAILED', approvalError: String(error.message).slice(0, 300), nextApprovalRetryAt: Date.now() + 10 * 60_000 }
      : { approvalStatus: 'SEND_UNCERTAIN', approvalError: 'Telegram send outcome is unknown; automatic retry was stopped.' });
    if (!error?.telegramRejected) await notifyAdmins(`Content Plan approval ${ref.id}: Telegram send outcome is unknown; inspect the chat before retrying.`);
    return false;
  }
  try {
    await ref.update({ approvalStatus: 'REQUESTED', approvalMessageId: message.message_id, approvalChatId: String(link.chatId), approvalTelegramUserId: String(link.telegramUserId), approvalRequestedAt: FieldValue.serverTimestamp() });
    return true;
  } catch (error) {
    // Telegram accepted the message. Blindly retrying REQUESTING would create
    // a duplicate prompt; the stale state is surfaced for operator recovery.
    console.error('Approval prompt was sent but its message id was not saved:', error);
    await notifyAdmins(`Content Plan approval ${ref.id}: Telegram sent the prompt but its message ID was not saved. The owner can still tap the button.`);
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

const samePlanContent = (post, other) => other?.userId === post.userId
  && other?.sourcePlanItemId === post.sourcePlanItemId
  && other?.groupId === post.groupId
  && other?.content === post.content
  && String(other?.videoUrl || other?.mediaUrl || '') === String(post.videoUrl || post.mediaUrl || '');

// Older plan replacement deleted the source row while leaving its approval
// posts. Restore only an entirely unpublished, internally consistent group.
export async function restoreOrphanedApprovalSource(db, post) {
  if (!post?.sourcePlanItemId || post.groupId !== `plan-${post.sourcePlanItemId}`) return false;
  const ref = db.collection('content_plan_items').doc(post.sourcePlanItemId);
  return db.runTransaction(async (tx) => {
    const source = await tx.get(ref);
    if (source.exists) return false;
    const siblings = await tx.get(db.collection('scheduled_posts').where('sourcePlanItemId', '==', post.sourcePlanItemId));
    if (!siblings.docs.length || !siblings.docs.every((doc) => samePlanContent(post, doc.data())
      && doc.id === `plan-${post.sourcePlanItemId}-${String(doc.data()?.platform || '').toLowerCase()}`
      && doc.data()?.aiSuggested === true
      && doc.data()?.approvalRequired === true
      && (['PENDING', 'AWAITING_APPROVAL'].includes(doc.data()?.status)
        || (doc.data()?.status === 'CANCELLED' && doc.data()?.cancelledReason === 'Content Plan was replaced.'))
      && !['APPROVED', 'REJECTED'].includes(doc.data()?.approvalStatus))
      || !siblings.docs.some((doc) => doc.data()?.approvalStatus === 'REQUESTED')) return false;
    tx.create(ref, {
      userId: post.userId, status: 'DONE', approvalRequired: true,
      autoPublishDestinations: true, approvalFanoutReady: true,
      type: post.mediaType === 'video' ? 'video' : 'image',
      resultMediaUrl: String(post.videoUrl || post.mediaUrl || ''),
      archivedAt: FieldValue.serverTimestamp(), restoredFromApprovalPosts: true,
    });
    siblings.docs.filter((doc) => doc.data()?.status === 'CANCELLED').forEach((doc) => tx.update(doc.ref, {
      status: 'AWAITING_APPROVAL', cancelledReason: null,
    }));
    return true;
  });
}

export async function reconcilePendingApprovalGroups(db, limit = 100) {
  const snapshot = await db.collection('scheduled_posts').where('approvalStatus', '==', 'REQUESTED').limit(100).get();
  const itemIds = [...new Set(snapshot.docs.map((doc) => doc.data()?.sourcePlanItemId).filter(Boolean))].slice(0, limit);
  for (const itemId of itemIds) {
    const group = await db.collection('scheduled_posts').where('sourcePlanItemId', '==', itemId).get();
    const candidates = group.docs.filter((doc) => doc.data()?.approvalStatus === 'REQUESTED'
      && (doc.data()?.status === 'AWAITING_APPROVAL'
        || (doc.data()?.status === 'CANCELLED' && doc.data()?.cancelledReason === 'Content Plan was replaced.')));
    if (!candidates.length) continue;
    const first = candidates[0].data();
    if (!group.docs.every((doc) => samePlanContent(first, doc.data())
      && !['PUBLISHED', 'PROCESSING'].includes(doc.data()?.status))) continue;
    await restoreOrphanedApprovalSource(db, first);
    if (!(await db.collection('content_plan_items').doc(itemId).get()).exists) continue;
    const refreshed = await db.collection('scheduled_posts').where('sourcePlanItemId', '==', itemId).get();
    const requested = refreshed.docs.filter((doc) => doc.data()?.approvalStatus === 'REQUESTED'
      && doc.data()?.status === 'AWAITING_APPROVAL');
    if (requested.length < 2) continue;
    const canonical = requested.find((doc) => doc.data()?.platform === 'TELEGRAM') || requested[0];
    const link = (await db.collection('telegram_approval_links').doc(first.userId).get()).data();
    const profile = (await db.collection('business_profiles').doc(String(link?.botOwnerId || first.userId)).get()).data();
    if (!profile?.telegramBotToken) continue;
    for (const duplicate of requested) {
      if (duplicate.id === canonical.id) continue;
      const data = duplicate.data();
      if (!data.approvalMessageId || data.approvalChatId !== canonical.data().approvalChatId
        || data.approvalTelegramUserId !== canonical.data().approvalTelegramUserId) continue;
      try {
        await botCall('editMessageReplyMarkup', {
          chat_id: data.approvalChatId, message_id: data.approvalMessageId,
          reply_markup: { inline_keyboard: [] },
        }, profile.telegramBotToken);
      } catch (error) {
        if (!/message is not modified/i.test(String(error?.message || ''))) {
          console.warn('Could not remove a redundant Content Plan approval keyboard:', error?.message || error);
          continue;
        }
      }
      await duplicate.ref.update({ approvalStatus: 'GROUP_PENDING', duplicateApprovalMessageId: data.approvalMessageId });
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
  const before = await ref.get();
  if (before.exists && before.data()?.userId === binding.uid && before.data()?.sourcePlanItemId
    && ((before.data()?.approvalStatus === 'REQUESTED' && before.data()?.approvalMessageId === messageId
      && String(before.data()?.approvalChatId) === chatId && String(before.data()?.approvalTelegramUserId) === actorId)
      || (['REQUESTING', 'SEND_UNCERTAIN'].includes(before.data()?.approvalStatus)
        && !before.data()?.approvalMessageId && callback.message?.from?.is_bot === true))) {
    await restoreOrphanedApprovalSource(db, before.data());
  }
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const post = snap.data();
    const knownMessage = post?.approvalStatus === 'REQUESTED'
      && String(post.approvalChatId) === chatId && String(post.approvalTelegramUserId) === actorId
      && post.approvalMessageId === messageId;
    const recoveredMessage = ['REQUESTING', 'SEND_UNCERTAIN'].includes(post?.approvalStatus)
      && !post?.approvalMessageId && callback.message?.from?.is_bot === true;
    if (!post || post.userId !== binding.uid || post.approvalRequired !== true || post.status !== 'AWAITING_APPROVAL'
      || (!knownMessage && !recoveredMessage)) return { ok: false, text: 'This request is no longer pending.' };
    if (post.sourcePlanItemId) {
      const source = await tx.get(db.collection('content_plan_items').doc(post.sourcePlanItemId));
      if (!source.exists || source.data()?.supersededBy || !validContentPlanPost(postId, post, source.data())) {
        tx.update(ref, { status: 'CANCELLED', cancelledReason: 'Content Plan was replaced.' });
        return { ok: false, text: 'This Content Plan was replaced.' };
      }
    }
    const group = [{ id: postId, data: post, ref }];
    let sourceRef = null;
    if (post.sourcePlanItemId) sourceRef = db.collection('content_plan_items').doc(post.sourcePlanItemId);
    if (post.sourcePlanItemId && post.groupId === `plan-${post.sourcePlanItemId}`) {
      const siblings = await tx.get(db.collection('scheduled_posts').where('sourcePlanItemId', '==', post.sourcePlanItemId));
      if (siblings.docs.some((sibling) => sibling.data()?.userId === post.userId
        && sibling.data()?.groupId === post.groupId && ['PUBLISHED', 'PROCESSING'].includes(sibling.data()?.status))) {
        return { ok: false, text: 'This content has already started publishing.' };
      }
      for (const sibling of siblings.docs) {
        const data = sibling.data();
        if (data?.userId !== post.userId || data?.groupId !== post.groupId) continue;
        if (!samePlanContent(post, data) || data?.approvalRequired !== true
          || !['PENDING', 'AWAITING_APPROVAL'].includes(data?.status)
          || ['APPROVED', 'REJECTED'].includes(data?.approvalStatus) || !isDue(data)) {
          return { ok: false, text: 'This approval group changed. No destination was modified.' };
        }
        if (sibling.id === postId) continue;
        group.push({ id: sibling.id, data, ref: sibling.ref });
      }
    }
    for (const member of group) {
      tx.update(member.ref, choice === 'y'
        ? { status: 'PENDING', approvalStatus: 'APPROVED', approvedAt: FieldValue.serverTimestamp(), approvedByTelegramUserId: actorId }
        : { approvalStatus: 'REJECTED', status: 'CANCELLED', rejectedAt: FieldValue.serverTimestamp(), rejectedByTelegramUserId: actorId });
    }
    if (sourceRef && choice === 'n') {
      tx.update(sourceRef, {
        status: 'DELETING', archivedAt: FieldValue.serverTimestamp(),
        rejectedAt: FieldValue.serverTimestamp(), deletionClaimedAt: null,
      });
    }
    const decisions = group.map(({ id, data }) => ({ postId: id, platform: data.platform, scheduledTime: data.scheduledTime,
      approvalMessageId: id === postId && recoveredMessage ? messageId : data.approvalMessageId }));
    return { ok: true, approved: choice === 'y', decisions, postId, platform: post.platform, scheduledTime: post.scheduledTime,
      ...(choice === 'n' && sourceRef ? { deletePlanItemId: post.sourcePlanItemId } : {}),
      text: choice === 'y' ? `Approved for ${decisions.map((item) => item.platform).join(', ')}. Publishing now.` : 'Rejected. This content will not publish; its generated media is being deleted.' };
  });
  return result;
}
