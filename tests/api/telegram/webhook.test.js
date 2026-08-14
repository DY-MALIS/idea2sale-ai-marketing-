import { describe, expect, it } from 'vitest';
import { getAutomationActive, replyRuleTriggerMatches, splitReplyRuleTriggers } from '../../../api/telegram/webhook.js';

describe('getAutomationActive', () => {
  const makeFakeDb = (data) => ({
    collection: () => ({
      doc: () => ({
        async get() {
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  });

  it('defaults to active when the settings doc does not exist', async () => {
    const db = makeFakeDb(undefined);
    expect(await getAutomationActive(db)).toBe(true);
  });

  it('is active when active is explicitly true', async () => {
    const db = makeFakeDb({ active: true });
    expect(await getAutomationActive(db)).toBe(true);
  });

  it('is paused only when active is explicitly false', async () => {
    const db = makeFakeDb({ active: false });
    expect(await getAutomationActive(db)).toBe(false);
  });

  it('fails open (active) if the lookup throws', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          async get() {
            throw new Error('firestore down');
          },
        }),
      }),
    };
    expect(await getAutomationActive(db)).toBe(true);
  });
});

describe('splitReplyRuleTriggers / replyRuleTriggerMatches (sanity)', () => {
  it('splits comma/pipe/newline separated triggers', () => {
    expect(splitReplyRuleTriggers('hi, price | delivery\nrefund')).toEqual([
      'hi', 'price', 'delivery', 'refund',
    ]);
  });

  it('matches short Latin triggers only on word boundaries', () => {
    expect(replyRuleTriggerMatches('hi there', 'hi')).toBe(true);
    expect(replyRuleTriggerMatches('this is a test', 'hi')).toBe(false);
  });
});
