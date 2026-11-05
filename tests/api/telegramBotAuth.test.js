import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ botCall: vi.fn(), sendDue: vi.fn() }));
vi.mock('../../api/_telegramApproval.js', () => ({ botCall: mock.botCall, sendDueApprovalsForUser: mock.sendDue }));
const { handleApprovalBotLogin } = await import('../../api/_telegramBotAuth.js');

const fakeDb = () => {
  const rows = new Map();
  const ref = (name, id) => ({
    key: `${name}/${id}`,
    async get() { return { data: () => rows.get(this.key) }; },
    async set(data) { rows.set(this.key, data); },
    async update(data) { rows.set(this.key, { ...rows.get(this.key), ...data }); },
    async delete() { rows.delete(this.key); },
  });
  return {
    rows,
    collection(name) { return { doc(id) { return ref(name, id); } }; },
    batch() {
      const operations = [];
      return {
        set(target, data) { operations.push(() => rows.set(target.key, data)); },
        delete(target) { operations.push(() => rows.delete(target.key)); },
        async commit() { operations.forEach((operation) => operation()); },
      };
    },
  };
};

const message = (text, id = 1) => ({ text, message_id: id, from: { id: 100 }, chat: { id: 200, type: 'private' } });
const login = (db, value) => handleApprovalBotLogin(db, value, 'firebase-user', 'test-bot-token', true);

describe('approval bot account linking', () => {
  beforeEach(() => {
    mock.botCall.mockReset().mockResolvedValue(true);
    mock.sendDue.mockReset().mockResolvedValue(undefined);
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'public-test-key');
  });

  it('intercepts credentials, links the verified Firebase UID, and signs out', async () => {
    const db = fakeDb();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'firebase-user', idToken: 'discard-me', refreshToken: 'discard-me' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await login(db, message('/start'))).toBe(true);
    expect(await login(db, message('person@example.com', 2))).toBe(true);
    expect(await login(db, message('super-secret-password', 3))).toBe(true);
    expect(db.rows.get('telegram_approval_chats/firebase-user_100')).toMatchObject({ uid: 'firebase-user', chatId: '200' });
    expect(db.rows.get('telegram_approval_links/firebase-user')).toMatchObject({ telegramUserId: '100' });
    expect(JSON.stringify([...db.rows])).not.toContain('super-secret-password');
    expect(JSON.stringify([...db.rows])).not.toContain('discard-me');
    expect(mock.botCall).toHaveBeenCalledWith('deleteMessage', { chat_id: '200', message_id: 3 }, 'test-bot-token');
    expect(mock.sendDue).toHaveBeenCalledWith(db, 'firebase-user');
    expect(await login(db, message('/logout', 4))).toBe(true);
    expect(db.rows.has('telegram_approval_chats/firebase-user_100')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('does not link an account after invalid credentials', async () => {
    const db = fakeDb();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'INVALID_PASSWORD' } }) }));
    await login(db, message('/login'));
    await login(db, message('person@example.com', 2));
    expect(await login(db, message('wrong-password', 3))).toBe(true);
    expect(db.rows.has('telegram_approval_chats/firebase-user_100')).toBe(false);
    expect(mock.sendDue).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not link a valid account to someone else\'s owner bot', async () => {
    const db = fakeDb();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'different-owner' }) }));
    await login(db, message('/start'));
    await login(db, message('person@example.com', 2));
    await login(db, message('valid-password', 3));
    expect(db.rows.has('telegram_approval_chats/firebase-user_100')).toBe(false);
    expect(mock.sendDue).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps failed-attempt limits when /login is restarted', async () => {
    const db = fakeDb();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await login(db, message('/login'));
    await login(db, message('person@example.com', 2));
    for (let attempt = 0; attempt < 5; attempt += 1) await login(db, message('bad-password', attempt + 3));
    await login(db, message('/login', 9));
    await login(db, message('person@example.com', 10));
    await login(db, message('bad-password', 11));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(db.rows.get('telegram_approval_login_states/firebase-user_100').blockedUntil).toBeGreaterThan(Date.now());
    vi.unstubAllGlobals();
  });
});
