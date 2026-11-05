import { describe, expect, it } from 'vitest';
import { claimPendingPost } from '../../api/_telegramClaim.js';
import { decideApproval } from '../../api/_telegramApproval.js';

const fakeDb = (posts, binding = { uid: 'owner', chatId: '200' }) => ({
  collection(name) {
    return {
      doc(id) {
        return {
          id, parent: { id: name },
          async get() { return { exists: Boolean(name === 'telegram_approval_chats' ? binding : posts[id]), data: () => name === 'telegram_approval_chats' ? binding : posts[id] }; },
          async update(patch) { posts[id] = { ...posts[id], ...patch }; },
        };
      },
    };
  },
  runTransaction(fn) {
    return fn({
      async get(ref) { return { exists: Boolean(posts[ref.id]), id: ref.id, data: () => posts[ref.id] }; },
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
