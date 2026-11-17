// Existing chat bindings are retained for account-scoped chatbot replies and
// shared-channel publishing. New sign-in links are no longer created.
const chatRef = (db, botOwnerId, actorId) => db.collection('telegram_approval_chats').doc(`${botOwnerId}_${actorId}`);
const linkRef = (db, uid) => db.collection('telegram_approval_links').doc(uid);

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
