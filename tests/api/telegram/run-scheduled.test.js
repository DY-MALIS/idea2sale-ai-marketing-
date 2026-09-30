import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyIdToken, mockGetFirestore } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockGetFirestore: vi.fn(),
}));
vi.mock('firebase-admin', () => ({
  default: {
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
    apps: [],
    initializeApp: vi.fn(),
    app: vi.fn(),
    credential: { cert: vi.fn() },
  },
}));
vi.mock('firebase-admin/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  getFirestore: mockGetFirestore,
}));

const { GENERATED_VIDEO_STATUSES, applyImageKitDeliveryTransform, applyImageKitLogoOverlay, escapeTelegramHtml, formatTelegramHtml, postTelegramMessage, sendTelegram, telegramMediaUrlFor, telegramTextFor, truncateForTelegram } =
  await import('../../../api/telegram/run-scheduled.js');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  mockVerifyIdToken.mockReset();
  mockGetFirestore.mockReset();
  vi.restoreAllMocks();
});

const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader() { return this; },
  };
  return res;
};

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

it('counts videos waiting for human review against the daily generation quota', () => {
  expect(GENERATED_VIDEO_STATUSES).toEqual(['DONE', 'PROCESSING', 'REVIEW']);
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

describe('telegramTextFor', () => {
  it('keeps formatted link-heavy text within Telegram\'s final HTML limit', () => {
    const text = `Check this out: ${'[Shop now](https://example.com/very/long/product/path?ref=campaign-xyz-123456789) '.repeat(20)}`;
    const result = telegramTextFor(text, 200);

    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns the complete formatted HTML when it already fits', () => {
    expect(telegramTextFor('See [our site](https://example.com)', 200))
      .toBe('See <a href="https://example.com">our site</a>');
  });

  it('handles nullish input without emitting an ellipsis', () => {
    expect(telegramTextFor(undefined, 10)).toBe('');
    expect(telegramTextFor(null, 10)).toBe('');
  });
});

describe('applyImageKitDeliveryTransform', () => {
  const imageUrl = 'https://ik.imagekit.io/demo/telegram-media/foo.png';
  const videoUrl = 'https://ik.imagekit.io/demo/telegram-media/foo.mp4';

  it('inserts a resize transform for an image URL', () => {
    const result = applyImageKitDeliveryTransform(imageUrl, 'photo');
    expect(new URL(result).searchParams.get('tr')).toBe('w-1280,q-auto,f-auto');
  });

  it('inserts a resize transform for a video URL', () => {
    const result = applyImageKitDeliveryTransform(videoUrl, 'video');
    expect(new URL(result).searchParams.get('tr')).toBe('w-1280,q-85,f-mp4');
  });

  it('is idempotent -- calling it twice does not double up the transform', () => {
    const once = applyImageKitDeliveryTransform(imageUrl, 'photo');
    const twice = applyImageKitDeliveryTransform(once, 'photo');
    expect(twice).toBe(once);
  });

  it('leaves non-ImageKit URLs unchanged', () => {
    const url = 'https://example.com/some/image.png';
    expect(applyImageKitDeliveryTransform(url, 'photo')).toBe(url);
  });

  it('leaves an empty string unchanged', () => {
    expect(applyImageKitDeliveryTransform('', 'photo')).toBe('');
  });
});

describe('Telegram video delivery', () => {
  beforeEach(() => {
    process.env.IMAGEKIT_PUBLIC_KEY = 'public-test';
    process.env.IMAGEKIT_PRIVATE_KEY = 'private-test';
    process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/demo';
  });

  it('serves an uploaded MP4 as original bytes when video transformations are exhausted', async () => {
    const source = 'https://ik.imagekit.io/demo/telegram-media/video.mp4';
    const delivered = telegramMediaUrlFor(source, 'video');
    expect(new URL(delivered).searchParams.get('tr')).toBe('orig-true');
    expect(new URL(telegramMediaUrlFor(`${source}?tr=w-1280%2Cq-85%2Cf-mp4`, 'video')).searchParams.get('tr')).toBe('orig-true');

    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '26183412' }),
        arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer,
      })
      .mockResolvedValueOnce(okTelegramResponse());
    global.fetch = fetchSpy;
    await sendTelegram({ userId: 'u1', content: 'caption', mediaType: 'video', mediaUrl: source }, fakeDbWithProfile({ telegramBotToken: 'own-token', telegramChatId: 'own-chat' }));
    expect(fetchSpy.mock.calls[0][0]).toBe(delivered);
    expect(fetchSpy.mock.calls[1][0]).toContain('/sendVideo');
    expect(fetchSpy.mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(fetchSpy.mock.calls[1][1].body.get('video').size).toBe(3);
  });

  it('preserves generated video overlays and narration transforms', () => {
    const source = 'https://ik.imagekit.io/demo/video.mp4?tr=ac-none%3Al-image%2Ci-logo.png%2Cl-end';
    expect(telegramMediaUrlFor(source, 'video')).toBe(source);
  });

  it('stops before posting if stored video delivery is still blocked', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    global.fetch = fetchSpy;
    await expect(sendTelegram({
      userId: 'u1', content: 'caption', mediaType: 'video', mediaUrl: 'https://ik.imagekit.io/demo/video.mp4',
    }, fakeDbWithProfile({ telegramBotToken: 'own-token', telegramChatId: 'own-chat' }))).rejects.toThrow('ImageKit');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('applyImageKitLogoOverlay', () => {
  it('adds the saved logo as a relative bottom-left video layer', () => {
    const result = applyImageKitLogoOverlay(
      'https://ik.imagekit.io/demo/telegram-media/video.mp4',
      '/telegram-media/company-logo.png',
    );
    expect(new URL(result).searchParams.get('tr')).toContain('l-image,i-telegram-media@@company-logo.png,w-bw_mul_0.16');
    expect(new URL(result).searchParams.get('tr')).toContain('lfo-bottom_left,lx-20,ly-20,l-end');
  });

  it('leaves the video unchanged for an invalid logo id', () => {
    const url = 'https://ik.imagekit.io/demo/video.mp4';
    expect(applyImageKitLogoOverlay(url, '../bad id')).toBe(url);
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
  it('requires the owner profile instead of using a shared channel', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;

    await expect(sendTelegram({ userId: 'u1', content: 'hello' })).rejects.toThrow('Business Profile');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an owner with no Telegram destination', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const db = fakeDbWithProfile({ businessName: 'Acme' });

    await expect(sendTelegram({ userId: 'u1', content: 'hello' }, db)).rejects.toThrow('Business Profile');
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it('sends each company only to its saved channel username with its own bot key', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const profiles = {
      companyA: { telegramBotToken: 'bot-a', telegramChatId: '-100old', telegramChannelUrl: 'https://t.me/channel_a' },
      companyB: { telegramBotToken: 'bot-b', telegramChannelUrl: '@channel_b' },
    };
    const db = { collection: () => ({ doc: (uid) => ({ get: async () => ({ data: () => profiles[uid] }) }) }) };
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;

    await sendTelegram({ userId: 'companyA', content: 'A only' }, db);
    await sendTelegram({ userId: 'companyB', content: 'B only' }, db);
    expect(fetchSpy.mock.calls.map(([url, options]) => [url, JSON.parse(options.body).chat_id])).toEqual([
      [expect.stringContaining('botbot-a'), '@channel_a'],
      [expect.stringContaining('botbot-b'), '@channel_b'],
    ]);
    expect(fetchSpy.mock.calls.every(([url]) => !url.includes('shared-token'))).toBe(true);
  });

  it('never broadcasts an ownerless legacy post to the shared channel', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    await expect(sendTelegram({ content: 'ownerless' })).rejects.toThrow('Business Profile');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires both bot token and channel ID', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const db = fakeDbWithProfile({ telegramBotToken: 'own-token-only' });

    await expect(sendTelegram({ userId: 'u1', content: 'hello' }, db)).rejects.toThrow('Business Profile');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not send to another channel if the owner profile lookup throws', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    const fetchSpy = vi.fn().mockResolvedValue(okTelegramResponse());
    global.fetch = fetchSpy;
    const throwingDb = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) };

    await expect(sendTelegram({ userId: 'u1', content: 'hello' }, throwingDb)).rejects.toThrow('Business Profile');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when neither the shared nor a per-user destination is configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    await expect(sendTelegram({ userId: 'u1', content: 'hello' })).rejects.toThrow('Business Profile');
  });
});

describe('postTelegramMessage (the "send now"/live-polling immediate-send path)', () => {
  it('uploads a hosted video as multipart when sending immediately', async () => {
    process.env.IMAGEKIT_PUBLIC_KEY = 'public-test';
    process.env.IMAGEKIT_PRIVATE_KEY = 'private-test';
    process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/demo';
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
    process.env.FIREBASE_PRIVATE_KEY = 'test-key';
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u1' });
    mockGetFirestore.mockReturnValue(fakeDbWithProfile({ telegramBotToken: 'own-token', telegramChatId: 'own-chat' }));
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
      .mockResolvedValueOnce(okTelegramResponse());
    global.fetch = fetchSpy;

    const res = createMockRes();
    await postTelegramMessage({
      method: 'POST', headers: { authorization: 'Bearer good-token' },
      body: { text: 'caption', mediaType: 'video', mediaUrl: 'https://ik.imagekit.io/demo/video.mp4' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(fetchSpy.mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(fetchSpy.mock.calls[1][1].body.get('video').size).toBe(3);
  });

  it('rejects demo mode instead of posting to a shared channel', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true, result: { message_id: 42 } }) });

    const req = { method: 'POST', headers: {}, body: { text: 'hello' } };
    const res = createMockRes();
    await postTelegramMessage(req, res);

    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid sign-in instead of using the shared channel', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true, result: { message_id: 42 } }) });

    const req = { method: 'POST', headers: { authorization: 'Bearer bad-token' }, body: { text: 'hello' } };
    const res = createMockRes();
    await postTelegramMessage(req, res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("uses the signed-in caller's own channel when their Business Profile has one configured", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    process.env.TELEGRAM_CHAT_ID = 'shared-chat';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
    process.env.FIREBASE_PRIVATE_KEY = 'test-key';
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u1' });
    mockGetFirestore.mockReturnValue(fakeDbWithProfile({ telegramBotToken: 'own-token', telegramChatId: 'own-chat' }));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true, result: { message_id: 42 } }) });

    const req = { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { text: 'hello' } };
    const res = createMockRes();
    await postTelegramMessage(req, res);

    expect(global.fetch.mock.calls[0][0]).toContain('bot' + 'own-token');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).chat_id).toBe('own-chat');
    expect(res.statusCode).toBe(200);
  });
});
