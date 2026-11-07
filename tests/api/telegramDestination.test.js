import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTelegramDestination, sharedBotCanPublishToChannel } from '../../api/_telegramDestination.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_SHARED_CHANNEL_ID;
  delete process.env.TELEGRAM_SHARED_BOT_OWNER_UID;
});

const admins = [
  { status: 'creator', user: { id: 123 } },
  { status: 'administrator', can_post_messages: true, user: { id: 456, username: 'dgacademy_official_bot' } },
];

const fakeDb = ({ account = {}, link = null, binding = null, owner = {} } = {}) => ({
  collection: (name) => ({
    doc: (id) => ({
      get: async () => ({ data: () => name === 'business_profiles'
        ? (id === 'customer' ? account : owner)
        : name === 'telegram_approval_links' ? link
        : binding }),
    }),
  }),
});

describe('shared Telegram publishing destination', () => {
  it('publishes a Google-linked business to the configured shared channel without its own channel', async () => {
    process.env.TELEGRAM_SHARED_CHANNEL_ID = '-1004495121549';
    process.env.TELEGRAM_SHARED_BOT_OWNER_UID = 'bot-owner';
    const db = fakeDb({
      account: { businessName: 'Customer Business' },
      link: { botOwnerId: 'bot-owner', telegramUserId: '123', chatId: '123' },
      binding: { uid: 'customer', botOwnerId: 'bot-owner', chatId: '123' },
      owner: { telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' },
    });
    expect(await resolveTelegramDestination(db, 'customer')).toEqual({ token: 'shared-token', chatId: '-1004495121549' });
    expect(await resolveTelegramDestination(db, 'customer', false)).toEqual({ token: '', chatId: '' });
  });

  it('lets the shared bot owner use the configured channel while approvals still require a private chat link', async () => {
    process.env.TELEGRAM_SHARED_CHANNEL_ID = '-1004495121549';
    process.env.TELEGRAM_SHARED_BOT_OWNER_UID = 'bot-owner';
    const db = fakeDb({ owner: { businessName: 'DGACADEMY', telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' } });
    expect(await resolveTelegramDestination(db, 'bot-owner')).toEqual({ token: 'shared-token', chatId: '-1004495121549' });
  });

  it('uses the shared bot token with the linked website account channel', async () => {
    process.env.TELEGRAM_SHARED_CHANNEL_ID = '-1004495121549';
    process.env.TELEGRAM_SHARED_BOT_OWNER_UID = 'bot-owner';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: admins }) }));
    const db = fakeDb({
      account: { telegramBotToken: 'stale-token', telegramChannelUrl: '@customerchannel' },
      link: { botOwnerId: 'bot-owner', telegramUserId: '123', chatId: '123' },
      binding: { uid: 'customer', botOwnerId: 'bot-owner', chatId: '123' },
      owner: { telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' },
    });
    expect(await resolveTelegramDestination(db, 'customer')).toEqual({ token: 'shared-token', chatId: '@customerchannel' });
  });

  it('requires the linked user and shared bot to be channel posting admins', () => {
    expect(sharedBotCanPublishToChannel(admins, '123')).toBe(true);
    expect(sharedBotCanPublishToChannel(admins, '999')).toBe(false);
    expect(sharedBotCanPublishToChannel([{ ...admins[0], status: 'member' }, admins[1]], '123')).toBe(false);
    expect(sharedBotCanPublishToChannel([admins[0], { ...admins[1], can_post_messages: false }], '123')).toBe(false);
  });

  it('rejects a stale or mismatched shared bot link', async () => {
    const db = fakeDb({
      account: { telegramBotToken: 'stale-token', telegramChannelUrl: '@customerchannel' },
      link: { botOwnerId: 'bot-owner', telegramUserId: '123', chatId: '123' },
      binding: { uid: 'someone-else', botOwnerId: 'bot-owner', chatId: '123' },
      owner: { telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' },
    });
    expect(await resolveTelegramDestination(db, 'customer')).toEqual({ token: '', chatId: '' });
  });

  it('refuses a channel where the linked user is not an administrator', async () => {
    process.env.TELEGRAM_SHARED_CHANNEL_ID = '-1004495121549';
    process.env.TELEGRAM_SHARED_BOT_OWNER_UID = 'bot-owner';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: admins.slice(1) }) }));
    const db = fakeDb({
      account: { telegramChannelUrl: '@otherchannel' },
      link: { botOwnerId: 'bot-owner', telegramUserId: '123', chatId: '123' },
      binding: { uid: 'customer', botOwnerId: 'bot-owner', chatId: '123' },
      owner: { telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' },
    });
    expect(await resolveTelegramDestination(db, 'customer')).toEqual({ token: '', chatId: '' });
  });

  it('keeps an unlinked owner bot destination unchanged', async () => {
    const db = fakeDb({ account: { telegramBotToken: 'owner-token', telegramChannelUrl: '@ownerchannel' } });
    expect(await resolveTelegramDestination(db, 'customer')).toEqual({ token: 'owner-token', chatId: '@ownerchannel' });
  });

  it('prefers the bot owner’s saved channel over the shared fallback', async () => {
    process.env.TELEGRAM_SHARED_CHANNEL_ID = '-1004495121549';
    process.env.TELEGRAM_SHARED_BOT_OWNER_UID = 'bot-owner';
    const db = fakeDb({ owner: { businessName: 'DGACADEMY', telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot', telegramChannelUrl: '@ownchannel' } });
    expect(await resolveTelegramDestination(db, 'bot-owner')).toEqual({ token: 'shared-token', chatId: '@ownchannel' });
  });
});
