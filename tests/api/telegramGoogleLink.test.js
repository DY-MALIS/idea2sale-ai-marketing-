import { describe, expect, it } from 'vitest';
import { disconnectGoogleLink, linkedWebsiteUid } from '../../api/_telegramGoogleLink.js';

const fakeDb = () => {
  const rows = new Map([
    ['telegram_approval_chats/bot-owner_123', { uid: 'website-user', botOwnerId: 'bot-owner', chatId: '123' }],
    ['telegram_approval_links/website-user', { telegramUserId: '123', botOwnerId: 'bot-owner', chatId: '123' }],
  ]);
  const ref = (collection, id) => ({
    key: `${collection}/${id}`,
    async get() { return { data: () => rows.get(this.key) }; },
  });
  return {
    rows,
    collection(name) { return { doc(id) { return ref(name, id); } }; },
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        get(target) { return target.get(); },
        delete(target) { writes.push(() => rows.delete(target.key)); },
      });
      writes.forEach((write) => write());
      return result;
    },
  };
};

describe('existing Telegram chat binding', () => {
  it('accepts only the matching owner, actor, and chat', async () => {
    const db = fakeDb();
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', '123')).toBe('website-user');
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', 'wrong-chat')).toBe('');
    expect(await linkedWebsiteUid(db, 'other-owner', '123', '123')).toBe('');
  });

  it('disconnects only the matching chat', async () => {
    const db = fakeDb();
    expect(await disconnectGoogleLink(db, 'bot-owner', '123', 'wrong-chat')).toBe(false);
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', '123')).toBe('website-user');
    expect(await disconnectGoogleLink(db, 'bot-owner', '123', '123')).toBe(true);
    expect(await linkedWebsiteUid(db, 'bot-owner', '123', '123')).toBe('');
  });
});
