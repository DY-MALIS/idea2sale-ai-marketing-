import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ botCall: vi.fn(), sendDue: vi.fn() }));
vi.mock('../../api/_telegramApproval.js', () => ({ botCall: mock.botCall, sendDueApprovalsForUser: mock.sendDue }));
const { createGoogleLink, completeGoogleLink, disconnectGoogleLink, linkedWebsiteUid } = await import('../../api/_telegramGoogleLink.js');

const fakeDb = () => {
  const rows = new Map([['business_profiles/bot-owner', { telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot', telegramBotToken: 'bot-token' }]]);
  const ref = (collection, id) => ({
    key: `${collection}/${id}`,
    async get() { return { data: () => rows.get(this.key) }; },
    async create(data) { if (rows.has(this.key)) throw new Error('exists'); rows.set(this.key, data); },
  });
  return {
    rows,
    collection(name) { return { doc(id) { return ref(name, id); } }; },
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        get(target) { return target.get(); },
        set(target, data) { writes.push(() => rows.set(target.key, data)); },
        delete(target) { writes.push(() => rows.delete(target.key)); },
      });
      writes.forEach((write) => write());
      return result;
    },
  };
};
const user = (uid, creationTime) => ({ uid, emailVerified: true, providerData: [{ providerId: 'google.com' }], metadata: { creationTime } });

describe('shared Telegram bot Google account link', () => {
  beforeEach(() => { mock.botCall.mockReset().mockResolvedValue({}); mock.sendDue.mockReset().mockResolvedValue(undefined); });

  it('binds an existing Google account once, without storing the link secret', async () => {
    const db = fakeDb();
    const url = await createGoogleLink(db, { botOwnerId: 'bot-owner', actorId: '123', chatId: '123', baseUrl: 'https://example.com' });
    const state = new URL(url).searchParams.get('state');
    expect(url).toContain('/telegram-connect?state=');
    expect(JSON.stringify([...db.rows])).not.toContain(state);
    expect(await completeGoogleLink(db, state, user('website-user', '2020-01-01T00:00:00Z'))).toEqual({ ok: true });
    expect(db.rows.get('telegram_approval_links/website-user')).toMatchObject({ botOwnerId: 'bot-owner', telegramUserId: '123' });
    expect(db.rows.get('telegram_approval_chats/bot-owner_123')).toMatchObject({ uid: 'website-user', botOwnerId: 'bot-owner' });
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', '123')).toBe('website-user');
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', 'wrong-chat')).toBe('');
    expect(mock.sendDue).toHaveBeenCalledWith(db, 'website-user');
    expect((await completeGoogleLink(db, state, user('website-user', '2020-01-01T00:00:00Z'))).ok).toBe(false);
  });

  it('rejects new, unverified, and expired accounts or links', async () => {
    const db = fakeDb();
    const state = new URL(await createGoogleLink(db, { botOwnerId: 'bot-owner', actorId: '123', chatId: '123', baseUrl: 'https://example.com' })).searchParams.get('state');
    expect((await completeGoogleLink(db, state, user('new-user', '2099-01-01T00:00:00Z'))).ok).toBe(false);
    expect((await completeGoogleLink(db, state, { ...user('old-user', '2020-01-01T00:00:00Z'), emailVerified: false })).ok).toBe(false);
    const pending = [...db.rows].find(([key]) => key.startsWith('telegram_google_link_states/'))[1];
    pending.expiresAt = Date.now() - 1;
    expect((await completeGoogleLink(db, state, user('old-user', '2020-01-01T00:00:00Z'))).ok).toBe(false);
    expect(db.rows.has('telegram_approval_links/old-user')).toBe(false);
  });

  it('disconnects only the matching Telegram chat', async () => {
    const db = fakeDb();
    const state = new URL(await createGoogleLink(db, { botOwnerId: 'bot-owner', actorId: '123', chatId: '123', baseUrl: 'https://example.com' })).searchParams.get('state');
    await completeGoogleLink(db, state, user('website-user', '2020-01-01T00:00:00Z'));
    expect(await disconnectGoogleLink(db, 'bot-owner', '123', 'other-chat')).toBe(false);
    expect(db.rows.has('telegram_approval_links/website-user')).toBe(true);
    expect(await disconnectGoogleLink(db, 'bot-owner', '123', '123')).toBe(true);
    expect(db.rows.has('telegram_approval_links/website-user')).toBe(false);
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', '123')).toBe('');
  });

  it('replaces only the prior binding when a chat connects to another website account', async () => {
    const db = fakeDb();
    const first = new URL(await createGoogleLink(db, { botOwnerId: 'bot-owner', actorId: '123', chatId: '123', baseUrl: 'https://example.com' })).searchParams.get('state');
    await completeGoogleLink(db, first, user('first-user', '2020-01-01T00:00:00Z'));
    const second = new URL(await createGoogleLink(db, { botOwnerId: 'bot-owner', actorId: '123', chatId: '123', baseUrl: 'https://example.com' })).searchParams.get('state');
    await completeGoogleLink(db, second, user('second-user', '2020-01-01T00:00:00Z'));
    expect(db.rows.has('telegram_approval_links/first-user')).toBe(false);
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', '123')).toBe('second-user');
  });
});
