import { botCall, sendDueApprovalsForUser } from './_telegramApproval.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const stateRef = (db, ownerId, actorId) => db.collection('telegram_approval_login_states').doc(`${ownerId}_${actorId}`);
const chatRef = (db, ownerId, actorId) => db.collection('telegram_approval_chats').doc(`${ownerId}_${actorId}`);
const codeRef = (db, ownerId) => db.collection('telegram_approval_login_codes').doc(ownerId);
const hashCode = (code) => createHash('sha256').update(code).digest('hex');
const LOGIN_CODE_LIFETIME_MS = 10 * 60_000;
const say = (chatId, text, token) => botCall('sendMessage', { chat_id: chatId, text }, token);
const forgetMessage = async (chatId, messageId, token) => {
  try { await botCall('deleteMessage', { chat_id: chatId, message_id: messageId }, token); } catch { /* Telegram deletion is best effort. */ }
};

export async function issueApprovalLoginCode(db, ownerId) {
  const code = randomBytes(6).toString('hex').toUpperCase();
  await codeRef(db, ownerId).set({ codeHash: hashCode(code), expiresAt: Date.now() + LOGIN_CODE_LIFETIME_MS });
  return code;
}

const linkWithCode = async (db, ownerId, actorId, chatId, code) => {
  const result = await db.runTransaction(async (tx) => {
    const loginCode = (await tx.get(codeRef(db, ownerId))).data();
    const actual = Buffer.from(String(loginCode?.codeHash || ''), 'hex');
    const expected = Buffer.from(hashCode(code), 'hex');
    if (!loginCode || loginCode.expiresAt <= Date.now() || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const existingChat = (await tx.get(chatRef(db, ownerId, actorId))).data();
    const existingOwner = (await tx.get(db.collection('telegram_approval_links').doc(ownerId))).data();
    if (existingChat?.uid && existingChat.uid !== ownerId) tx.delete(db.collection('telegram_approval_links').doc(existingChat.uid));
    if (existingOwner?.telegramUserId && String(existingOwner.telegramUserId) !== actorId) tx.delete(chatRef(db, ownerId, existingOwner.telegramUserId));
    tx.set(chatRef(db, ownerId, actorId), { uid: ownerId, chatId, linkedAt: new Date() });
    tx.set(db.collection('telegram_approval_links').doc(ownerId), { telegramUserId: actorId, chatId, linkedAt: new Date() });
    tx.delete(codeRef(db, ownerId));
    tx.delete(stateRef(db, ownerId, actorId));
    return true;
  });
  return result;
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
  const codeMatch = text.match(/^\/login\s+([A-Fa-f0-9]{12})$/i);
  if (codeMatch) {
    await forgetMessage(chatId, message.message_id, botToken);
    if (Number(state?.blockedUntil || 0) > Date.now()) {
      await say(chatId, 'Too many attempts. Try again in 15 minutes.', botToken);
      return true;
    }
    const linked = await linkWithCode(db, ownerId, actorId, chatId, codeMatch[1].toUpperCase());
    if (!linked) {
      const windowStartedAt = Date.now() - Number(state?.codeWindowStartedAt || 0) < 15 * 60_000
        ? state.codeWindowStartedAt : Date.now();
      const attempts = (windowStartedAt === state?.codeWindowStartedAt ? Number(state?.codeAttempts || 0) : 0) + 1;
      await stateRef(db, ownerId, actorId).set({ ...state, ownerId, chatId, codeAttempts: attempts, codeWindowStartedAt: windowStartedAt, blockedUntil: attempts >= 5 ? Date.now() + 15 * 60_000 : 0 });
      await say(chatId, 'Invalid or expired code. Generate a new code in Business Profile.', botToken);
      return true;
    }
    await say(chatId, 'Signed in. Due posts will arrive here with Yes and No buttons. Send /logout to disconnect.', botToken);
    await sendDueApprovalsForUser(db, ownerId);
    return true;
  }
  if (/^\/login(?:\s|$)/i.test(text) || (allowStart && /^\/start$/i.test(text))) {
    if (Number(state?.blockedUntil || 0) > Date.now()) {
      await say(chatId, 'Too many attempts. Try again in 15 minutes.', botToken);
      return true;
    }
    await stateRef(db, ownerId, actorId).set({ stage: 'EMAIL', chatId, ownerId, startedAt: Date.now(), attempts: Date.now() - Number(state?.startedAt || 0) < 15 * 60_000 ? Number(state?.attempts || 0) : 0, codeAttempts: Number(state?.codeAttempts || 0), codeWindowStartedAt: Number(state?.codeWindowStartedAt || 0) });
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
