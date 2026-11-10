import { describe, expect, it, vi } from 'vitest';
import { claimPendingPost } from '../../api/_telegramClaim.js';
import { decideApproval, ensureApprovalRequest, reconcilePendingApprovalGroups } from '../../api/_telegramApproval.js';

const fakeDb = (posts, binding = { uid: 'owner', chatId: '200' }, links = {}) => ({
  collection(name) {
    return {
      where(field, _op, value) { return {
        queryName: name, field, value,
        limit() { return this; },
        async get() { return { docs: Object.entries(posts).filter(([, data]) => data?.[field] === value).map(([id, data]) => ({
          id, ref: { id, update: async (patch) => { posts[id] = { ...posts[id], ...patch }; } }, data: () => data,
        })) }; },
      }; },
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
      create(ref, data) { posts[ref.id] = data; },
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
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', status: 'AWAITING_APPROVAL', approvalRequired: true, aiSuggested: true, mediaUrl: 'https://example.com/photo.jpg', approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', scheduledTime: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString() };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM', approvalMessageId: 7 },
      'plan-item-facebook': { ...base, platform: 'FACEBOOK', approvalMessageId: 8 },
      unrelated: { ...base, userId: 'someone-else', platform: 'TELEGRAM', approvalMessageId: 9 },
      item: { userId: 'owner', status: 'DONE', archivedAt: new Date(), resultMediaUrl: base.mediaUrl, approvalRequired: true, autoPublishDestinations: true },
    };
    const result = await decideApproval(fakeDb(posts), callback('y', 'plan-item-facebook', 100, 200, 8), 'owner');
    expect(result.decisions.map((decision) => decision.platform).sort()).toEqual(['FACEBOOK', 'TELEGRAM']);
    expect(posts['plan-item-telegram']).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
    expect(posts['plan-item-facebook']).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
    expect(posts.unrelated.approvalStatus).toBe('REQUESTED');
  });

  it('sends one prompt for all destinations and keeps the other post waiting', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', status: 'PENDING', approvalRequired: true, aiSuggested: true, approvalStatus: 'AWAITING_DUE', scheduledTime: new Date(Date.now() - 1000).toISOString(), mediaUrl: 'https://example.com/photo.jpg' };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM' }, 'plan-item-facebook': { ...base, platform: 'FACEBOOK' },
      item: { userId: 'owner', status: 'DONE', approvalFanoutReady: true, resultMediaUrl: base.mediaUrl, approvalRequired: true, autoPublishDestinations: true },
      'bot-owner': { telegramBotToken: 'shared-token', telegramBotActive: true },
    };
    const links = { owner: { botOwnerId: 'bot-owner', telegramUserId: '100', chatId: '200' } };
    const db = fakeDb(posts, { uid: 'owner', botOwnerId: 'bot-owner', chatId: '200' }, links);
    const originalTransaction = db.runTransaction.bind(db);
    let transactionQueue = Promise.resolve();
    db.runTransaction = (operation) => {
      const next = transactionQueue.then(() => originalTransaction(operation));
      transactionQueue = next.catch(() => {});
      return next;
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 77 } }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await ensureApprovalRequest(db, db.collection('scheduled_posts').doc('plan-item-facebook'))).toBe(false);
      const concurrent = await Promise.all([
        ensureApprovalRequest(db, db.collection('scheduled_posts').doc('plan-item-telegram')),
        ensureApprovalRequest(db, db.collection('scheduled_posts').doc('plan-item-telegram')),
      ]);
      expect(concurrent.filter(Boolean)).toHaveLength(1);
      expect(await ensureApprovalRequest(db, db.collection('scheduled_posts').doc('plan-item-telegram'))).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toContain('TELEGRAM, FACEBOOK');
      expect(posts['plan-item-facebook'].approvalStatus).toBe('AWAITING_DUE');
    } finally { vi.unstubAllGlobals(); }
  });

  it('warns about a finished plan video and waits for Yes before publishing any destination', async () => {
    const mediaUrl = 'https://example.com/review.mp4';
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Video',
      status: 'PENDING', approvalRequired: true, aiSuggested: true, approvalStatus: 'AWAITING_DUE',
      scheduledTime: new Date(Date.now() - 1000).toISOString(), mediaType: 'video' };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM', mediaUrl, videoUrl: '' },
      'plan-item-youtube': { ...base, platform: 'YOUTUBE', mediaUrl: '', videoUrl: mediaUrl },
      item: { userId: 'owner', type: 'video', status: 'DONE', approvalFanoutReady: true,
        resultMediaUrl: mediaUrl, approvalRequired: true, autoPublishDestinations: true,
        approvalReviewWarnings: ['The Khmer speech did not pass automatic verification. Listen before approving.'] },
      'bot-owner': { telegramBotToken: 'shared-token', telegramBotActive: true },
    };
    const links = { owner: { botOwnerId: 'bot-owner', telegramUserId: '100', chatId: '200' } };
    const db = fakeDb(posts, { uid: 'owner', botOwnerId: 'bot-owner', chatId: '200' }, links);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 77 } }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await claimPendingPost(db, db.collection('scheduled_posts').doc('plan-item-youtube')))
        .toMatchObject({ skipped: 'awaiting_approval' });
      expect(posts['plan-item-youtube'].status).not.toBe('PROCESSING');
      expect(await ensureApprovalRequest(db, db.collection('scheduled_posts').doc('plan-item-telegram'))).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('VIDEO NEEDS YOUR REVIEW');
      expect(body.text).toContain(mediaUrl);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await decideApproval(db, callback('y', 'plan-item-telegram', 100, 200, 77), 'bot-owner')).approved).toBe(true);
      expect(posts['plan-item-telegram']).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
      expect(posts['plan-item-youtube']).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
    } finally { vi.unstubAllGlobals(); }
  });

  it('removes the redundant keyboard from an old two-message group', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', mediaUrl: 'https://example.com/photo.jpg', aiSuggested: true, approvalRequired: true, status: 'AWAITING_APPROVAL', approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100' };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM', approvalMessageId: 7 },
      'plan-item-facebook': { ...base, platform: 'FACEBOOK', approvalMessageId: 8 },
      item: { userId: 'owner', status: 'DONE', resultMediaUrl: base.mediaUrl, approvalRequired: true, autoPublishDestinations: true },
      'bot-owner': { telegramBotToken: 'shared-token', telegramBotActive: true },
    };
    const db = fakeDb(posts, { uid: 'owner', botOwnerId: 'bot-owner', chatId: '200' }, { owner: { botOwnerId: 'bot-owner', chatId: '200', telegramUserId: '100' } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: true }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await reconcilePendingApprovalGroups(db);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).message_id).toBe(8);
      expect(posts['plan-item-facebook'].approvalStatus).toBe('GROUP_PENDING');
      expect(posts['plan-item-telegram'].approvalStatus).toBe('REQUESTED');
    } finally { vi.unstubAllGlobals(); }
  });

  it('No cancels every pending destination and marks generated media for deletion once', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', status: 'AWAITING_APPROVAL', approvalRequired: true, aiSuggested: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', scheduledTime: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(), mediaUrl: 'https://example.com/photo.jpg' };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM', approvalMessageId: 7 },
      'plan-item-facebook': { ...base, platform: 'FACEBOOK', approvalMessageId: 8 },
      item: { userId: 'owner', status: 'DONE', resultMediaUrl: base.mediaUrl, approvalRequired: true, autoPublishDestinations: true },
    };
    const db = fakeDb(posts);
    const result = await decideApproval(db, callback('n', 'plan-item-telegram'), 'owner');
    expect(result).toMatchObject({ ok: true, approved: false, deletePlanItemId: 'item' });
    expect(posts['plan-item-telegram']).toMatchObject({ status: 'CANCELLED', approvalStatus: 'REJECTED' });
    expect(posts['plan-item-facebook']).toMatchObject({ status: 'CANCELLED', approvalStatus: 'REJECTED' });
    expect(posts.item.status).toBe('DELETING');
    expect((await decideApproval(db, callback('y', 'plan-item-telegram'), 'owner')).ok).toBe(false);
  });

  it('refuses No if any destination has already published', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', mediaUrl: 'https://example.com/photo.jpg', aiSuggested: true, approvalRequired: true, scheduledTime: new Date(Date.now() - 1000).toISOString() };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM', status: 'AWAITING_APPROVAL', approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 },
      'plan-item-facebook': { ...base, platform: 'FACEBOOK', status: 'PUBLISHED', approvalStatus: 'APPROVED' },
      item: { userId: 'owner', status: 'DONE', resultMediaUrl: base.mediaUrl, approvalRequired: true, autoPublishDestinations: true },
    };
    expect((await decideApproval(fakeDb(posts), callback('n', 'plan-item-telegram'), 'owner')).ok).toBe(false);
    expect(posts.item.status).toBe('DONE');
    expect(posts['plan-item-telegram'].approvalStatus).toBe('REQUESTED');
  });

  it('rejects a forged Content Plan post whose media differs from the generated output', async () => {
    const posts = {
      'plan-item-telegram': { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', platform: 'TELEGRAM', content: 'Photo', mediaUrl: 'https://example.com/another-users-photo.jpg', aiSuggested: true, approvalRequired: true, status: 'AWAITING_APPROVAL', approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 },
      item: { userId: 'owner', status: 'DONE', resultMediaUrl: 'https://example.com/own-photo.jpg', approvalRequired: true, autoPublishDestinations: true },
    };
    expect((await decideApproval(fakeDb(posts), callback('n', 'plan-item-telegram'), 'owner')).ok).toBe(false);
    expect(posts.item.status).toBe('DONE');
  });

  it('restores a consistent orphaned old approval before a late Yes', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', status: 'AWAITING_APPROVAL', approvalRequired: true, aiSuggested: true, approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', scheduledTime: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(), mediaUrl: 'https://example.com/photo.jpg' };
    const posts = { 'plan-item-telegram': { ...base, platform: 'TELEGRAM', approvalMessageId: 7 }, 'plan-item-facebook': { ...base, platform: 'FACEBOOK', approvalMessageId: 8 } };
    const result = await decideApproval(fakeDb(posts), callback('y', 'plan-item-telegram'), 'owner');
    expect(result.ok).toBe(true);
    expect(posts.item).toMatchObject({ userId: 'owner', status: 'DONE', restoredFromApprovalPosts: true });
    expect(posts['plan-item-facebook'].approvalStatus).toBe('APPROVED');
  });

  it('revives a legacy sibling cancelled only because plan replacement removed its source', async () => {
    const base = { userId: 'owner', groupId: 'plan-item', sourcePlanItemId: 'item', content: 'Photo', approvalRequired: true, aiSuggested: true, scheduledTime: new Date(Date.now() - 1000).toISOString(), mediaUrl: 'https://example.com/photo.jpg' };
    const posts = {
      'plan-item-telegram': { ...base, platform: 'TELEGRAM', status: 'AWAITING_APPROVAL', approvalStatus: 'REQUESTED', approvalChatId: '200', approvalTelegramUserId: '100', approvalMessageId: 7 },
      'plan-item-facebook': { ...base, platform: 'FACEBOOK', status: 'CANCELLED', cancelledReason: 'Content Plan was replaced.', approvalStatus: 'AWAITING_DUE' },
    };
    const result = await decideApproval(fakeDb(posts), callback('y', 'plan-item-telegram'), 'owner');
    expect(result.ok).toBe(true);
    expect(result.decisions.map((decision) => decision.platform).sort()).toEqual(['FACEBOOK', 'TELEGRAM']);
    expect(posts['plan-item-facebook']).toMatchObject({ status: 'PENDING', approvalStatus: 'APPROVED' });
  });

  it('accepts a delivered prompt with an uncertain database write without resending it', async () => {
    const posts = { post: { userId: 'owner', platform: 'FACEBOOK', status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'SEND_UNCERTAIN' } };
    const db = fakeDb(posts);
    const recovered = { ...callback('y', 'post'), message: { message_id: 7, chat: { id: 200 }, from: { is_bot: true } } };
    expect((await decideApproval(db, recovered, 'owner')).approved).toBe(true);
    expect(posts.post.approvalStatus).toBe('APPROVED');
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
