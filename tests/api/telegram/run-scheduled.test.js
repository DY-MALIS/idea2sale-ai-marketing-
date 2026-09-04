import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCloudinaryDeliveryTransform, escapeTelegramHtml, formatTelegramHtml, sendTelegram, truncateForTelegram } from '../../../api/telegram/run-scheduled.js';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const fakeDbWithProfile = (profileData) => ({
  collection: () => ({
    doc: () => ({
      get: async () => ({ data: () => profileData }),
    }),
  }),
});

const okTelegramResponse = () => ({
  ok: true,
  json: async () => ({ ok: true, result: { message_id: 42 } }),
});

describe('truncateForTelegram', () => {
  it('leaves short text untouched', () => {
    expect(truncateForTelegram('hello', 1024)).toBe('hello');
  });

  it('truncates text over the limit and appends an ellipsis', () => {
    const text = 'a'.repeat(2000);
    const result = truncateForTelegram(text, 1024);
    expect(result.length).toBe(1024);
    expect(result.endsWith('…')).toBe(true);
  });

  it('treats non-string/nullish input as empty', () => {
    expect(truncateForTelegram(undefined, 10)).toBe('');
    expect(truncateForTelegram(null, 10)).toBe('');
  });
});

describe('applyCloudinaryDeliveryTransform', () => {
  const imageUrl = 'https://res.cloudinary.com/demo/image/upload/v1700000000/telegram-media/foo.png';
  const videoUrl = 'https://res.cloudinary.com/demo/video/upload/v1700000000/telegram-media/foo.mp4';

  it('inserts a resize transform for an image URL', () => {
    const result = applyCloudinaryDeliveryTransform(imageUrl, 'photo');
    expect(result).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_1280,q_auto,f_auto/v1700000000/telegram-media/foo.png'
    );
  });

  it('inserts a resize transform for a video URL', () => {
    const result = applyCloudinaryDeliveryTransform(videoUrl, 'video');
    expect(result).toBe(
      'https://res.cloudinary.com/demo/video/upload/q_auto,w_1280/v1700000000/telegram-media/foo.mp4'
    );
  });

  it('is idempotent -- calling it twice does not double up the transform', () => {
    const once = applyCloudinaryDeliveryTransform(imageUrl, 'photo');
    const twice = applyCloudinaryDeliveryTransform(once, 'photo');
    expect(twice).toBe(once);
  });

  it('leaves non-Cloudinary URLs unchanged', () => {
    const url = 'https://example.com/some/image.png';
    expect(applyCloudinaryDeliveryTransform(url, 'photo')).toBe(url);
  });

  it('leaves an empty string unchanged', () => {
    expect(applyCloudinaryDeliveryTransform('', 'photo')).toBe('');
  });
});

// Same regression coverage as tests/api/telegram/webhook.test.js -- this file
// has its own copy of the same formatting functions for the scheduled/send-now
// paths, so a fix applied to one without the other would otherwise go unnoticed.
describe('escapeTelegramHtml', () => {
  it('escapes &, <, > so a stray one never breaks parse_mode=HTML', () => {
    expect(escapeTelegramHtml('AT&T <script> a>b')).toBe('AT&amp;T &lt;script&gt; a&gt;b');
  });
});

describe('formatTelegramHtml', () => {
  it('converts bold, italic, inline code, and headings', () => {
    expect(formatTelegramHtml('## Hook\n**bold** and *italic* and `code`'))
      .toBe('<b>Hook</b>\n<b>bold</b> and <i>italic</i> and <code>code</code>');
  });

  it('converts markdown links', () => {
    expect(formatTelegramHtml('See [our site](https://example.com) now'))
      .toBe('See <a href="https://example.com">our site</a> now');
  });

  it('converts list markers to bullets without touching numbered lists', () => {
    expect(formatTelegramHtml('- one\n- two\n1. three')).toBe('• one\n• two\n1. three');
  });

  it('does not misread a spaced multiplication sign as italic emphasis', () => {
    expect(formatTelegramHtml('Price: $5 * 2 = $10')).toBe('Price: $5 * 2 = $10');
  });
});

describe('sendTelegram destination resolution', () => {
  it('uses the shared bot/channel when no db is passed', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;

    await sendTelegram({ userId: 'u1', content: 'hello' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('bot' + 'shared-token');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).chat_id).toBe('shared-chat');
  });

  it('uses the shared bot/channel when the post owner has no profile override', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const db = fakeDbWithProfile({ businessName: 'Acme' });

    await sendTelegram({ userId: 'u1', content: 'hello' }, db);

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).chat_id).toBe('shared-chat');
  });

  it('uses the post owner\'s own bot/channel when both fields are set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const db = fakeDbWithProfile({ telegramBotToken: 'own-token', telegramChatId: 'own-chat' });

    await sendTelegram({ userId: 'u1', content: 'hello' }, db);

    expect(fetchSpy.mock.calls[0][0]).toContain('bot' + 'own-token');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).chat_id).toBe('own-chat');
  });

  it('falls back to the shared channel if only one override field is set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const db = fakeDbWithProfile({ telegramBotToken: 'own-token-only' });

    await sendTelegram({ userId: 'u1', content: 'hello' }, db);

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).chat_id).toBe('shared-chat');
  });

  it('falls back to the shared channel if the profile lookup throws', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const throwingDb = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) };

    await sendTelegram({ userId: 'u1', content: 'hello' }, throwingDb);

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).chat_id).toBe('shared-chat');
  });

  it('throws when neither the shared nor a per-user destination is configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    await expect(sendTelegram({ userId: 'u1', content: 'hello' })).rejects.toThrow('not configured');
  });
});
