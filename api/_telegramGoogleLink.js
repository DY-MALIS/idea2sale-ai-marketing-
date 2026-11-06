import { createHash, randomBytes } from 'node:crypto';
import { botCall, sendDueApprovalsForUser } from './_telegramApproval.js';

const LINK_LIFETIME_MS = 10 * 60_000;
const stateId = (state) => createHash('sha256').update(state).digest('hex');
const chatRef = (db, botOwnerId, actorId) => db.collection('telegram_approval_chats').doc(`${botOwnerId}_${actorId}`);
const linkRef = (db, uid) => db.collection('telegram_approval_links').doc(uid);

export async function createGoogleLink(db, { botOwnerId, actorId, chatId, baseUrl }) {
  const state = randomBytes(24).toString('hex');
  await db.collection('telegram_google_link_states').doc(stateId(state)).create({
    botOwnerId, actorId: String(actorId), chatId: String(chatId),
    createdAt: Date.now(), expiresAt: Date.now() + LINK_LIFETIME_MS,
  });
  return `${baseUrl}/telegram-connect?state=${state}`;
}

export async function completeGoogleLink(db, state, user) {
  if (!/^[a-f0-9]{48}$/.test(String(state || ''))) return { ok: false, error: 'Invalid sign-in link.' };
  const ref = db.collection('telegram_google_link_states').doc(stateId(state));
  const result = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const pending = snapshot.data();
    if (!pending || pending.expiresAt <= Date.now()) return { ok: false, error: 'This link has expired. Send /login to the bot again.' };
    if (!user?.uid || !user?.emailVerified || !user?.providerData?.some((provider) => provider.providerId === 'google.com')) {
      return { ok: false, error: 'Sign in with a verified Google account on the website.' };
    }
    // A Google popup may create a brand-new Firebase account. Linking is only
    // for an account that already existed when the bot sent its link.
    const createdAt = Date.parse(user.metadata?.creationTime || '');
    if (!Number.isFinite(createdAt) || createdAt > pending.createdAt) {
      return { ok: false, error: 'Create your website account first, then send /login to the bot again.' };
    }
    const botProfile = await tx.get(db.collection('business_profiles').doc(pending.botOwnerId));
    if (botProfile.data()?.telegramBotActive !== true || !botProfile.data()?.telegramBotToken || String(botProfile.data()?.telegramBotUsername || '').toLowerCase() !== 'dgacademy_official_bot') {
      return { ok: false, error: 'The approval bot is not active.' };
    }
    const existingChat = (await tx.get(chatRef(db, pending.botOwnerId, pending.actorId))).data();
    const existingLink = (await tx.get(linkRef(db, user.uid))).data();
    if (existingChat?.uid && existingChat.uid !== user.uid) tx.delete(linkRef(db, existingChat.uid));
    if (existingLink?.telegramUserId && (String(existingLink.telegramUserId) !== pending.actorId || existingLink.botOwnerId !== pending.botOwnerId)) {
      tx.delete(chatRef(db, existingLink.botOwnerId || user.uid, existingLink.telegramUserId));
    }
    tx.set(chatRef(db, pending.botOwnerId, pending.actorId), {
      uid: user.uid, botOwnerId: pending.botOwnerId, chatId: pending.chatId, linkedAt: new Date(),
    });
    tx.set(linkRef(db, user.uid), {
      telegramUserId: pending.actorId, chatId: pending.chatId, botOwnerId: pending.botOwnerId, linkedAt: new Date(),
    });
    tx.delete(db.collection('telegram_approval_login_states').doc(`${pending.botOwnerId}_${pending.actorId}`));
    tx.delete(ref);
    return { ok: true, uid: user.uid, chatId: pending.chatId, botOwnerId: pending.botOwnerId, botToken: botProfile.data().telegramBotToken };
  });
  if (!result.ok) return result;
  await botCall('sendMessage', { chat_id: result.chatId, text: 'Your Telegram chat is connected to your website account. You can now receive post approvals. Send /logout to disconnect.' }, result.botToken).catch(() => {});
  await sendDueApprovalsForUser(db, result.uid).catch((error) => {
    console.error('Telegram link completed; due approval delivery deferred:', error?.message || error);
  });
  return { ok: true };
}

export async function disconnectGoogleLink(db, botOwnerId, actorId, chatId) {
  const ref = chatRef(db, botOwnerId, actorId);
  return db.runTransaction(async (tx) => {
    const binding = (await tx.get(ref)).data();
    if (!binding || String(binding.chatId) !== String(chatId)) return false;
    const ownerLink = await tx.get(linkRef(db, binding.uid));
    if (String(ownerLink.data()?.telegramUserId) === String(actorId) && ownerLink.data()?.botOwnerId === botOwnerId) tx.delete(linkRef(db, binding.uid));
    tx.delete(ref);
    return true;
  });
}

export async function linkedWebsiteUid(db, botOwnerId, actorId, chatId) {
  const binding = (await chatRef(db, botOwnerId, actorId).get()).data();
  if (!binding?.uid || binding.botOwnerId !== botOwnerId || String(binding.chatId) !== String(chatId)) return '';
  const link = (await linkRef(db, binding.uid).get()).data();
  if (!link || link.botOwnerId !== botOwnerId || String(link.chatId) !== String(chatId) || String(link.telegramUserId) !== String(actorId)) return '';
  return binding.uid;
}

export async function cleanupExpiredGoogleLinks(db) {
  const expired = await db.collection('telegram_google_link_states')
    .where('expiresAt', '<=', Date.now()).limit(100).get();
  if (expired.empty) return 0;
  const batch = db.batch();
  for (const doc of expired.docs) batch.delete(doc.ref);
  await batch.commit();
  return expired.docs.length;
}
