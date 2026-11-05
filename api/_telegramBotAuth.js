import { botCall, sendDueApprovalsForUser } from './_telegramApproval.js';

const stateRef = (db, ownerId, actorId) => db.collection('telegram_approval_login_states').doc(`${ownerId}_${actorId}`);
const chatRef = (db, ownerId, actorId) => db.collection('telegram_approval_chats').doc(`${ownerId}_${actorId}`);
const say = (chatId, text, token) => botCall('sendMessage', { chat_id: chatId, text }, token);
const forgetMessage = async (chatId, messageId, token) => {
  try { await botCall('deleteMessage', { chat_id: chatId, message_id: messageId }, token); } catch { /* Telegram deletion is best effort. */ }
};

export async function handleApprovalBotLogin(db, message, ownerId, botToken, allowStart = false) {
  if (message?.chat?.type !== 'private' || !message?.from?.id) return false;
  const actorId = String(message.from.id);
  const chatId = String(message.chat.id);
  const text = String(message.text || '').trim();
  const state = (await stateRef(db, ownerId, actorId).get()).data();
  if (/^\/logout(?:\s|$)/i.test(text)) {
    const binding = (await chatRef(db, ownerId, actorId).get()).data();
    const batch = db.batch();
    batch.delete(chatRef(db, ownerId, actorId));
    batch.delete(stateRef(db, ownerId, actorId));
    if (binding?.uid) batch.delete(db.collection('telegram_approval_links').doc(binding.uid));
    await batch.commit();
    await say(chatId, 'Signed out of approval notifications. Send /login to connect again.', botToken);
    return true;
  }
  if (allowStart && /^\/start$/i.test(text)) {
    const binding = (await chatRef(db, ownerId, actorId).get()).data();
    if (binding?.uid === ownerId && binding?.chatId === chatId) {
      await say(chatId, 'You are signed in for post approvals. Due posts will arrive here with Yes and No buttons. Send /logout to disconnect.', botToken);
      return true;
    }
  }
  if (/^\/login(?:\s|$)/i.test(text) || (allowStart && /^\/start$/i.test(text))) {
    if (Number(state?.blockedUntil || 0) > Date.now()) {
      await say(chatId, 'Too many attempts. Try again in 15 minutes.', botToken);
      return true;
    }
    await stateRef(db, ownerId, actorId).set({ stage: 'EMAIL', chatId, ownerId, startedAt: Date.now(), attempts: Date.now() - Number(state?.startedAt || 0) < 15 * 60_000 ? Number(state?.attempts || 0) : 0 });
    await say(chatId, 'Send your app account email. Then send your password in a separate message. This private chat passes through Telegram; deletion of credential messages is attempted but cannot be guaranteed.', botToken);
    return true;
  }
  if (!state || state.chatId !== chatId || state.ownerId !== ownerId) return false;
  if (Number(state.blockedUntil || 0) > Date.now()) {
    await forgetMessage(chatId, message.message_id, botToken);
    await say(chatId, 'Too many attempts. Try again in 15 minutes.', botToken);
    return true;
  }
  if (Date.now() - Number(state.startedAt || 0) > 15 * 60_000) {
    await forgetMessage(chatId, message.message_id, botToken);
    await stateRef(db, ownerId, actorId).delete();
    await say(chatId, 'Sign-in timed out. Send /login to start again.', botToken);
    return true;
  }
  if (state.stage === 'EMAIL') {
    await forgetMessage(chatId, message.message_id, botToken);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || text.length > 254) {
      await say(chatId, 'Enter a valid email address, or send /login to restart.', botToken);
      return true;
    }
    await stateRef(db, ownerId, actorId).update({ stage: 'PASSWORD', email: text.toLowerCase() });
    await say(chatId, 'Now send your password. The bot will attempt to delete that message immediately.', botToken);
    return true;
  }
  if (state.stage !== 'PASSWORD') return true;
  await forgetMessage(chatId, message.message_id, botToken);
  if (Number(state.attempts || 0) >= 5) {
    await stateRef(db, ownerId, actorId).update({ blockedUntil: Date.now() + 15 * 60_000 });
    await say(chatId, 'Too many sign-in attempts. Wait 15 minutes and send /login again.', botToken);
    return true;
  }
  await stateRef(db, ownerId, actorId).update({ attempts: Number(state.attempts || 0) + 1 });
  let uid = '';
  try {
    const key = String(process.env.VITE_FIREBASE_API_KEY || '').trim();
    if (!key) throw new Error('Firebase email sign-in is not configured.');
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.email, password: text, returnSecureToken: true }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.localId) throw new Error('Invalid email or password.');
    uid = result.localId;
    if (uid !== ownerId) throw new Error('Account does not own this bot.');
  } catch {
    await say(chatId, 'Could not sign in to this bot. Check your app account email and password, then send the password again.', botToken);
    return true;
  }
  const existingChat = (await chatRef(db, ownerId, actorId).get()).data();
  const existingOwner = (await db.collection('telegram_approval_links').doc(uid).get()).data();
  const batch = db.batch();
  if (existingChat?.uid && existingChat.uid !== uid) batch.delete(db.collection('telegram_approval_links').doc(existingChat.uid));
  if (existingOwner?.telegramUserId && String(existingOwner.telegramUserId) !== actorId) batch.delete(chatRef(db, ownerId, existingOwner.telegramUserId));
  batch.set(chatRef(db, ownerId, actorId), { uid, chatId, linkedAt: new Date() });
  batch.set(db.collection('telegram_approval_links').doc(uid), { telegramUserId: actorId, chatId, linkedAt: new Date() });
  batch.delete(stateRef(db, ownerId, actorId));
  await batch.commit();
  await say(chatId, 'Signed in. Due posts will arrive here with Yes and No buttons. Send /logout to disconnect.', botToken);
  await sendDueApprovalsForUser(db, uid);
  return true;
}
