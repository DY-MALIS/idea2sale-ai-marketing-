import { telegramDestinationFromProfile } from '../shared/telegramDestination.js';

export const sharedBotCanPublishToChannel = (administrators, telegramUserId) => {
  if (!Array.isArray(administrators)) return false;
  const member = administrators.find((admin) => String(admin.user?.id) === String(telegramUserId));
  const bot = administrators.find((admin) => String(admin.user?.username || '').toLowerCase() === 'dgacademy_official_bot');
  const mayPost = (admin) => admin?.status === 'creator' || (admin?.status === 'administrator' && admin.can_post_messages === true);
  return mayPost(member) && mayPost(bot);
};

// A linked account uses its own saved channel when the shared bot can post
// there. The configured shared channel is a fallback only when no channel was
// saved. The reciprocal chat binding prevents token borrowing.
export async function resolveTelegramDestination(db, userId, allowShared = true) {
  if (!db || !userId) return { token: '', chatId: '' };
  const [profileSnap, linkSnap] = await Promise.all([
    db.collection('business_profiles').doc(userId).get(),
    db.collection('telegram_approval_links').doc(userId).get(),
  ]);
  const profile = profileSnap.data() || {};
  const link = linkSnap.data();
  const sharedChannelId = String(process.env.TELEGRAM_SHARED_CHANNEL_ID || '').trim();
  const sharedOwnerId = String(process.env.TELEGRAM_SHARED_BOT_OWNER_UID || '').trim();
  if (!link?.botOwnerId) {
    const own = telegramDestinationFromProfile(profile);
    if (own.token && own.chatId) return own;
    return allowShared && !String(profile.telegramChannelUrl || profile.telegramChatId || '').trim()
      && sharedChannelId && userId === sharedOwnerId && profile.telegramBotActive === true
      && String(profile.telegramBotUsername || '').toLowerCase() === 'dgacademy_official_bot'
      && String(profile.businessName || '').trim()
      ? { token: String(profile.telegramBotToken || '').trim(), chatId: sharedChannelId }
      : { token: '', chatId: '' };
  }

  if (!link.telegramUserId || !link.chatId) return { token: '', chatId: '' };
  const [bindingSnap, botProfileSnap] = await Promise.all([
    db.collection('telegram_approval_chats').doc(`${link.botOwnerId}_${link.telegramUserId}`).get(),
    db.collection('business_profiles').doc(link.botOwnerId).get(),
  ]);
  const binding = bindingSnap.data();
  const botProfile = botProfileSnap.data() || {};
  if (binding?.uid !== userId || binding.botOwnerId !== link.botOwnerId
    || String(binding.chatId) !== String(link.chatId)
    || botProfile.telegramBotActive !== true
    || String(botProfile.telegramBotUsername || '').toLowerCase() !== 'dgacademy_official_bot') {
    return { token: '', chatId: '' };
  }
  const destination = telegramDestinationFromProfile({ ...profile, telegramBotToken: botProfile.telegramBotToken });
  if (!String(botProfile.telegramBotToken || '').trim()) return { token: '', chatId: '' };
  if (!destination.chatId) {
    return allowShared && !String(profile.telegramChannelUrl || profile.telegramChatId || '').trim()
      && sharedChannelId && link.botOwnerId === sharedOwnerId && String(profile.businessName || '').trim()
      ? { token: String(botProfile.telegramBotToken || '').trim(), chatId: sharedChannelId }
      : { token: '', chatId: '' };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${destination.token}/getChatAdministrators`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: destination.chatId, return_bots: true }),
      signal: AbortSignal.timeout(7000),
    });
    const result = await response.json();
    if (response.ok && result.ok && sharedBotCanPublishToChannel(result.result, link.telegramUserId)) return destination;
  } catch (error) {
    console.error('Could not verify shared bot channel access:', error?.message || error);
  }
  return { token: '', chatId: '' };
}
