// A public channel username takes priority over an older numeric chat ID.
// Telegram's sendMessage/sendPhoto/sendVideo APIs accept @channelname as chat_id.
export function channelUsernameFromProfile(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(?:https:\/\/(?:www\.)?t\.me\/|@)?([A-Za-z0-9_]{1,64})\/?$/i);
  return match ? `@${match[1]}` : '';
}

export function telegramDestinationFromProfile(profile = {}) {
  const token = String(profile.telegramBotToken || '').trim();
  const channel = String(profile.telegramChannelUrl || '').trim();
  // A malformed saved channel must fail closed, not silently post to an old ID.
  const chatId = channel
    ? channelUsernameFromProfile(channel)
    : String(profile.telegramChatId || '').trim();
  return token && chatId ? { token, chatId } : { token: '', chatId: '' };
}
