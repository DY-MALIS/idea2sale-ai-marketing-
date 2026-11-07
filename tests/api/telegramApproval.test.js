import { describe, expect, it, vi } from 'vitest';
import { claimPendingPost } from '../../api/_telegramClaim.js';
import { decideApproval, ensureApprovalRequest } from '../../api/_telegramApproval.js';

const fakeDb = (posts, binding = { uid: 'owner', chatId: '200' }, links = {}) => ({
  collection(name) {
    return {
      where(field, _op, value) { return { queryName: name, field, value }; },
      doc(id) {
        return {
          id, parent: { id: name },
          async get() { return { exists: Boolean(name === 'telegram_approval_chats' ? binding : name === 'telegram_approval_links' ? links[id] : posts[id]), data: () => name === 'telegram_approval_chats' ? binding : name === 'telegram_approval_links' ? links[id] : posts[id] }; },
          async update(patch) { posts[id] = { ...posts[id], ...patch }; },
        };
      },
    };
  },
  runTransaction(fn) {
    return fn({
      async get(ref) {
        if (ref.queryName) return { docs: Object.entries(posts).filter(([, data]) => data?.[ref.field] === ref.value).map(([id, data]) => ({ id, ref: { id }, data: () => data })) };
        return { exists: Boolean(posts[ref.id]), id: ref.id, data: () => posts[ref.id] };
      },
      update(ref, patch) { posts[ref.id] = { ...posts[ref.id], ...patch }; },
    });
  },
});

const callback = (choice, postId, actor = 100, chat = 200, message = 7) => ({
  data: `ap:${choice}:${postId}`, from: { id: actor }, message: { message_id: message, chat: { id: chat } },
});

describe('Telegram post approval', () => {
  it('requires approval before a scheduled post can be claimed', async () => {
    const posts = { p1: { userId: 'owner', platform: 'FACEBOOK', status: 'PENDING', approvalRequired: true, approvalStatus: 'AWAITING_DUE', scheduledTime: new Date(Date.now() + 60_000).toISOString() } };
    const db = fakeDb(posts);
    expect(await claimPendingPost(db, db.collection('scheduled_posts').doc('p1'))).toEqual({ skipped: 'awaiting_approval' });
    expect(posts.p1.status).toBe('PENDING');
    posts.p1.approvalStatus = 'APPROVED';
    expect((await claimPendingPost(db, db.collection('scheduled_posts').doc('p1'))).post.id).toBe('p1');
    expect(posts.p1.status).toBe('PROCESSING');
  });

  it('moves a due unlinked post out of the publish queue without sending it', async () => {
    const posts = { p1: { userId: 'owner', platform: 'YOUTUBE', status: 'PENDING', approvalRequired: true, approvalStatus: 'AWAITING_DUE', scheduledTime: new Date(Date.now() - 1000).toISOString() } };
    const db = fakeDb(posts);
    expect(await claimPendingPost(db, db.collection('scheduled_posts').doc('p1'))).toEqual({ skipped: 'awaiting_approval' });
    expect(posts.p1).toMatchObject({ status: 'AWAITING_APPROVAL', approvalStatus: 'AWAITING_LINK' });
  });

  it('accepts one platform while rejecting another and refuses repeated taps', async () => {
    const post = { userId: 'owner', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 };
    const posts = { facebook: { ...post, platform: 'FACEBOOK' }, youtube: { ...post, platform: 'YOUTUBE' } };
    const db = fakeDb(posts);
    expect((await decideApproval(db, callback('y', 'facebook'), 'owner')).approved).toBe(true);
    expect(posts.facebook).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
    expect((await decideApproval(db, callback('n', 'youtube'), 'owner')).approved).toBe(false);
    expect(posts.youtube).toMatchObject({ status: 'CANCELLED', approvalStatus: 'REJECTED' });
    expect((await decideApproval(db, callback('y', 'facebook'), 'owner')).ok).toBe(false);
    expect((await decideApproval(db, callback('y', 'youtube'), 'owner')).ok).toBe(false);
  });

  it('rejects a different Telegram actor, chat, or message', async () => {
    const posts = { post: { userId: 'owner', platform: 'TELEGRAM', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 } };
    const db = fakeDb(posts);
    expect((await decideApproval(db, callback('y', 'post', 101), 'owner')).ok).toBe(false);
    expect((await decideApproval(db, callback('y', 'post', 100, 201), 'owner')).ok).toBe(false);
    expect((await decideApproval(db, callback('y', 'post', 100, 200, 8), 'owner')).ok).toBe(false);
    expect(posts.post.approvalStatus).toBe('REQUESTED');
  });

  it('one Content Plan Yes approves Telegram and Facebook for the same account and item', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', scheduledTime: new Date(Date.now() - 1000).toISOString() };
    const posts = {
      telegram: { ...base, platform: 'TELEGRAM', approvalMessageId: 7 },
      facebook: { ...base, platform: 'FACEBOOK', approvalMessageId: 8 },
      unrelated: { ...base, userId: 'someone-else', platform: 'TELEGRAM', approvalMessageId: 9 },
      item: { userId: 'owner', status: 'DONE' },
    };
    const result = await decideApproval(fakeDb(posts), callback('y', 'facebook', 100, 200, 8), 'owner');
    expect(result.decisions.map((decision) => decision.platform).sort()).toEqual(['FACEBOOK', 'TELEGRAM']);
    expect(posts.telegram).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
    expect(posts.facebook).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
    expect(posts.unrelated.approvalStatus).toBe('REQUESTED');
  });

  it('lets a shared bot approve only the post owned by the linked website UID', async () => {
    const posts = {
      own: { userId: 'website-user', platform: 'TELEGRAM', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 },
      other: { userId: 'another-user', platform: 'TELEGRAM', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 },
    };
    const db = fakeDb(posts, { uid: 'website-user', botOwnerId: 'bot-owner', chatId: '200' }, { 'website-user': { botOwnerId: 'bot-owner', chatId: '200', telegramUserId: '100' } });
    expect((await decideApproval(db, callback('y', 'own'), 'bot-owner')).approved).toBe(true);
    expect((await decideApproval(db, callback('y', 'other'), 'bot-owner')).ok).toBe(false);
  });

  it('sends another user’s approval through the shared bot token', async () => {
    const posts = {
      post: { userId: 'website-user', platform: 'FACEBOOK', content: 'Preview', status: 'PENDING', approvalRequired: true, approvalStatus: 'AWAITING_DUE', scheduledTime: new Date(Date.now() - 1000).toISOString() },
      'bot-owner': { telegramBotToken: 'shared-bot-token', telegramBotActive: true },
      'website-user': { telegramBotToken: 'wrong-user-token', telegramBotActive: true },
    };
    const binding = { uid: 'website-user', botOwnerId: 'bot-owner', chatId: '200' };
    const links = { 'website-user': { botOwnerId: 'bot-owner', telegramUserId: '100', chatId: '200' } };
    const db = fakeDb(posts, binding, links);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 77 } }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await ensureApprovalRequest(db, db.collection('scheduled_posts').doc('post'))).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toContain('/botshared-bot-token/sendMessage');
      expect(posts.post.approvalStatus).toBe('REQUESTED');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('holds an old owner-bot link until the owner completes Google sign-in', async () => {
    const posts = {
      post: { userId: 'bot-owner', platform: 'TELEGRAM', status: 'PENDING', approvalRequired: true, approvalStatus: 'AWAITING_DUE', scheduledTime: new Date(Date.now() - 1000).toISOString() },
      'bot-owner': { telegramBotToken: 'bot-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' },
    };
    const db = fakeDb(posts, { uid: 'bot-owner', chatId: '200' }, { 'bot-owner': { telegramUserId: '100', chatId: '200' } });
    expect(await ensureApprovalRequest(db, db.collection('scheduled_posts').doc('post'))).toBe(false);
    expect(posts.post).toMatchObject({ status: 'AWAITING_APPROVAL', approvalStatus: 'AWAITING_LINK' });
  });

  it('cancels an approval whose Content Plan was replaced', async () => {
    const posts = {
      post: { userId: 'owner', platform: 'FACEBOOK', sourcePlanItemId: 'plan', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 },
      plan: { userId: 'owner', supersededBy: 'replacement' },
    };
    const result = await decideApproval(fakeDb(posts), callback('y', 'post'), 'owner');
    expect(result.ok).toBe(false);
    expect(posts.post.status).toBe('CANCELLED');
  });
});
