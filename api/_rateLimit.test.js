import { describe, expect, it } from 'vitest';
import { checkRateLimit, getClientIp } from './_rateLimit.js';

const makeFakeDb = (docs = {}) => ({
  collection: () => ({
    doc: (id) => ({ id }),
  }),
  async runTransaction(fn) {
    const tx = {
      async get(ref) {
        const data = docs[ref.id];
        return { exists: !!data, data: () => data };
      },
      set(ref, patch) {
        docs[ref.id] = { ...docs[ref.id], ...patch };
      },
    };
    return fn(tx);
  },
});

describe('getClientIp', () => {
  it('takes the first address from x-forwarded-for', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to the socket address when the header is absent', () => {
    const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' } };
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when nothing is available', () => {
    expect(getClientIp({ headers: {} })).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  it('allows requests under the limit and increments the counter', async () => {
    const db = makeFakeDb();
    const first = await checkRateLimit(db, { scope: 'ai', key: '1.2.3.4', limit: 2 });
    expect(first).toMatchObject({ allowed: true, count: 1 });
    const second = await checkRateLimit(db, { scope: 'ai', key: '1.2.3.4', limit: 2 });
    expect(second).toMatchObject({ allowed: true, count: 2 });
  });

  it('blocks once the limit is reached', async () => {
    const db = makeFakeDb();
    await checkRateLimit(db, { scope: 'ai', key: '1.2.3.4', limit: 1 });
    const blocked = await checkRateLimit(db, { scope: 'ai', key: '1.2.3.4', limit: 1 });
    expect(blocked.allowed).toBe(false);
  });

  it('keeps separate budgets per scope and per key', async () => {
    const db = makeFakeDb();
    await checkRateLimit(db, { scope: 'ai', key: '1.2.3.4', limit: 1 });
    const otherScope = await checkRateLimit(db, { scope: 'guest-token', key: '1.2.3.4', limit: 1 });
    const otherKey = await checkRateLimit(db, { scope: 'ai', key: '5.6.7.8', limit: 1 });
    expect(otherScope.allowed).toBe(true);
    expect(otherKey.allowed).toBe(true);
  });
});
