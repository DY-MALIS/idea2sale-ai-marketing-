// Read-only Bot API checks. Never include a token in a response or log.
export class TelegramConnectionError extends Error {
  constructor(code, message, { permanent = true, retrySafe = true } = {}) {
    super(message);
    this.code = code;
    this.permanent = permanent;
    this.retrySafe = retrySafe;
  }
}

const guidance = 'Add the selected bot as a channel Administrator with Post Messages permission, then test the connection again.';

export function classifyTelegramError(description = '', status = 0, { sendAttempted = false } = {}) {
  const value = String(description).toLowerCase();
  if (status === 401 || /unauthorized|invalid token/.test(value)) return new TelegramConnectionError('INVALID_TOKEN', 'Telegram rejected the bot token. Save a valid token in Business Profile.');
  if (/chat not found|invalid chat_id|chat_id is empty/.test(value)) return new TelegramConnectionError('CHANNEL_NOT_FOUND', 'Telegram could not find this channel. Check its public username or numeric channel ID, and ensure the bot can access it.');
  if (/not a member|bot was kicked|bot is not a member/.test(value)) return new TelegramConnectionError('BOT_NOT_MEMBER', `Telegram bot is not a member of this channel. ${guidance}`);
  if (/not enough rights|not enough permissions|can't post|can_post_messages|not an administrator|forbidden/.test(value)) return new TelegramConnectionError('MISSING_PERMISSION', `Telegram bot cannot post to this channel. ${guidance}`);
  if (status === 429) return new TelegramConnectionError('TEMPORARY', 'Telegram is rate limiting this bot. Delivery will retry shortly.', { permanent: false, retrySafe: true });
  if (status >= 500) return new TelegramConnectionError(sendAttempted ? 'SEND_UNCERTAIN' : 'CHECK_UNAVAILABLE', sendAttempted ? 'Telegram did not confirm this send. Check the channel before retrying to avoid a duplicate.' : 'Telegram is temporarily unavailable. Try again later.', { permanent: false, retrySafe: !sendAttempted });
  return new TelegramConnectionError(sendAttempted ? 'SEND_UNCERTAIN' : 'CHECK_FAILED', sendAttempted
    ? 'Telegram did not confirm this send. Check the channel before retrying to avoid a duplicate.'
    : 'Could not verify Telegram channel access. Try the connection test again.', { permanent: false, retrySafe: !sendAttempted });
}

async function call(token, method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new TelegramConnectionError('CHECK_UNAVAILABLE', 'Could not reach Telegram to verify this channel. Try again later.', { permanent: false });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw classifyTelegramError(data.description, response.status);
  return data.result;
}

export async function validateTelegramConnection({ token, chatId }) {
  if (!token || !chatId) throw new TelegramConnectionError('NOT_CONFIGURED', 'Save a bot token and channel in Business Profile first.');
  const bot = await call(token, 'getMe', {});
  if (!bot?.id) throw new TelegramConnectionError('INVALID_TOKEN', 'Telegram did not identify this bot. Check its token.');
  const chat = await call(token, 'getChat', { chat_id: chatId });
  if (chat?.type !== 'channel') throw new TelegramConnectionError('NOT_CHANNEL', 'The selected Telegram destination is not a channel. Save a channel username or ID.');
  const member = await call(token, 'getChatMember', { chat_id: chatId, user_id: bot.id });
  if (member?.status !== 'creator' && member?.status !== 'administrator') {
    throw new TelegramConnectionError('MISSING_PERMISSION', `Telegram bot is not a channel Administrator. ${guidance}`);
  }
  if (member.status === 'administrator' && member.can_post_messages !== true) {
    throw new TelegramConnectionError('MISSING_PERMISSION', `Telegram bot lacks Post Messages permission. ${guidance}`);
  }
  return { ready: true, channelId: String(chat.id), channelLabel: chat.username ? `@${chat.username}` : chat.title || String(chat.id), botUsername: bot.username || '' };
}

export function telegramFailure(error, { sendAttempted = false } = {}) {
  if (error instanceof TelegramConnectionError) return error;
  return classifyTelegramError(error?.message || '', Number(error?.statusCode) || 0, { sendAttempted });
}
