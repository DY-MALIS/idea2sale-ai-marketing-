import { describe, expect, it } from 'vitest';
import { telegramChannelLinkFromProfile, telegramDestinationFromProfile } from '../../shared/telegramDestination.js';

describe('profile Telegram destination', () => {
  it('uses the public channel username before an older numeric chat ID', () => {
    expect(telegramDestinationFromProfile({
      telegramBotToken: 'owner-bot',
      telegramChatId: '-100123456789',
      telegramChannelUrl: 'https://t.me/owner_channel',
    })).toEqual({ token: 'owner-bot', chatId: '@owner_channel' });
  });

  it('publishes with the saved @username while deriving a browser link separately', () => {
    expect(telegramDestinationFromProfile({ telegramBotToken: 'owner-bot', telegramChannelUrl: '@datingcafe168' }))
      .toEqual({ token: 'owner-bot', chatId: '@datingcafe168' });
    expect(telegramChannelLinkFromProfile('@datingcafe168')).toBe('https://t.me/datingcafe168');
    expect(telegramChannelLinkFromProfile('https://t.me/datingcafe168')).toBe('https://t.me/datingcafe168');
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
