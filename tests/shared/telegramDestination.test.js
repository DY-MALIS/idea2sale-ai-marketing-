import { describe, expect, it } from 'vitest';
import { telegramDestinationFromProfile } from '../../shared/telegramDestination.js';

describe('profile Telegram destination', () => {
  it('uses the public channel username before an older numeric chat ID', () => {
    expect(telegramDestinationFromProfile({
      telegramBotToken: 'owner-bot',
      telegramChatId: '-100123456789',
      telegramChannelUrl: 'https://t.me/owner_channel',
    })).toEqual({ token: 'owner-bot', chatId: '@owner_channel' });
  });

  it('accepts a numeric ID only when no username is saved', () => {
    expect(telegramDestinationFromProfile({ telegramBotToken: 'owner-bot', telegramChatId: '-100123456789' }))
      .toEqual({ token: 'owner-bot', chatId: '-100123456789' });
  });

  it('blocks an invalid saved username instead of falling back to a different channel', () => {
    expect(telegramDestinationFromProfile({
      telegramBotToken: 'owner-bot', telegramChatId: '-100123456789', telegramChannelUrl: 'https://t.me/+privateInvite',
    })).toEqual({ token: '', chatId: '' });
  });
});
