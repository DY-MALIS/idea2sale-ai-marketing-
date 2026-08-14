import { describe, expect, it } from 'vitest';
import { claimPendingPost, findRecentDuplicateTelegramPost } from '../../api/_telegramClaim.js';

// Minimal fake of the Admin SDK surface claimPendingPost/findRecentDuplicateTelegramPost
// actually touch -- just enough to exercise the claim/dedup logic without a real Firestore.
const makeFakeDb = ({ docs = {}, collectionDocs = [] } = {}) => ({
  async runTransaction(fn) {
    const tx = {
      async get(ref) {
        const data = docs[ref.id];
        return { exists: !!data, id: ref.id, data: () => data };
      },
      update(ref, patch) {
        docs[ref.id] = { ...docs[ref.id], ...patch };
      },
    };
    return fn(tx);
  },
  collection() {
    const filters = [];
    const builder = {
      where(field, _op, value) {
        filters.push([field, value]);
        return builder;
      },
      async get() {
        const matches = collectionDocs.filter((d) =>
          filters.every(([field, value]) => d.data[field] === value)
        );
        return { docs: matches.map((d) => ({ id: d.id, data: () => d.data })) };
      },
    };
    return builder;
  },
});

describe('claimPendingPost', () => {
  it('returns not_found for a missing document', async () => {
    const db = makeFakeDb({ docs: {} });
    const result = await claimPendingPost(db, { id: 'missing' });
    expect(result).toEqual({ skipped: 'not_found' });
  });

  it('claims a PENDING post and flips it to PROCESSING', async () => {
    const docs = { post1: { status: 'PENDING', content: 'hi' } };
    const db = makeFakeDb({ docs });
    const result = await claimPendingPost(db, { id: 'post1' });
    expect(result.post).toMatchObject({ id: 'post1', status: 'PENDING' });
    expect(docs.post1.status).toBe('PROCESSING');
  });

  it('refuses to claim a post that is already PROCESSING', async () => {
    const docs = { post1: { status: 'PROCESSING' } };
    const db = makeFakeDb({ docs });
    const result = await claimPendingPost(db, { id: 'post1' });
    expect(result).toEqual({ skipped: 'PROCESSING' });
    // must not have been touched further
    expect(docs.post1.status).toBe('PROCESSING');
  });
});

describe('findRecentDuplicateTelegramPost', () => {
  const mediaUrl = 'https://res.cloudinary.com/demo/image/upload/foo.png';
  const recentTs = { toMillis: () => Date.now() - 60_000 }; // 1 minute ago
  const staleTs = { toMillis: () => Date.now() - 20 * 60_000 }; // 20 minutes ago

  it('returns null when the post has no mediaUrl', async () => {
    const db = makeFakeDb({ collectionDocs: [] });
    const result = await findRecentDuplicateTelegramPost(db, { id: 'a', mediaUrl: '' });
    expect(result).toBeNull();
  });

  it('finds another recently-published post with the same media', async () => {
    const db = makeFakeDb({
      collectionDocs: [
        { id: 'other', data: { platform: 'TELEGRAM', mediaUrl, status: 'PUBLISHED', publishedAt: recentTs } },
      ],
    });
    const result = await findRecentDuplicateTelegramPost(db, { id: 'this', mediaUrl });
    expect(result).toBe('other');
  });

  it('does not match itself', async () => {
    const db = makeFakeDb({
      collectionDocs: [
        { id: 'this', data: { platform: 'TELEGRAM', mediaUrl, status: 'PUBLISHED', publishedAt: recentTs } },
      ],
    });
    const result = await findRecentDuplicateTelegramPost(db, { id: 'this', mediaUrl });
    expect(result).toBeNull();
  });

  it('ignores a match published outside the dedup window', async () => {
    const db = makeFakeDb({
      collectionDocs: [
        { id: 'other', data: { platform: 'TELEGRAM', mediaUrl, status: 'PUBLISHED', publishedAt: staleTs } },
      ],
    });
    const result = await findRecentDuplicateTelegramPost(db, { id: 'this', mediaUrl });
    expect(result).toBeNull();
  });
});
