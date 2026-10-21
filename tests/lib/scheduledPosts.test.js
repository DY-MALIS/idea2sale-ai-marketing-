import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDemoScheduledPosts,
  mergeStoredScheduleHistory,
} from '../../src/lib/scheduledPosts.ts';

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  };
};

const post = (overrides = {}) => ({
  id: 'post-1',
  content: 'Launch announcement',
  platform: 'TELEGRAM',
  scheduledTime: '2026-09-15T03:00:00.000Z',
  status: 'PENDING',
  userId: 'demo-user',
  aiSuggested: false,
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe('demo schedule carry-over', () => {
  it('shows only demo posts in demo mode on a shared browser', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([
      post({ id: 'demo' }),
      post({ id: 'owner-a', userId: 'owner-a' }),
      post({ id: 'legacy', userId: undefined }),
    ]));

    expect(getDemoScheduledPosts()).toEqual([post({ id: 'demo' })]);
  });

  it('shows schedules only for the active demo business', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([
      post({ id: 'bakery', businessName: 'Mekong Bakery Test' }),
      post({ id: 'florist', businessName: 'Angkor Florist Test' }),
      post({ id: 'legacy' }),
    ]));
    localStorage.setItem('demo_business_profile', JSON.stringify({ businessName: 'Mekong Bakery Test' }));
    expect(getDemoScheduledPosts()).toEqual([post({ id: 'bakery', businessName: 'Mekong Bakery Test' })]);
    localStorage.setItem('demo_business_profile', JSON.stringify({ businessName: 'Angkor Florist Test' }));
    expect(getDemoScheduledPosts()).toEqual([post({ id: 'florist', businessName: 'Angkor Florist Test' })]);
  });

  it('does not expose an old demo user\'s local schedule to a later signed-in user', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([post()]));

    expect(mergeStoredScheduleHistory([], 'real-user')).toEqual([]);
  });

  it('never attributes demo schedules to a signed-in account in the same session', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([post()]));
    expect(mergeStoredScheduleHistory([], 'real-user')).toEqual([]);
    expect(mergeStoredScheduleHistory([], 'another-user')).toEqual([]);
  });

  it('does not attribute ownerless legacy browser posts to a signed-in company', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([post({ userId: undefined })]));
    expect(mergeStoredScheduleHistory([], 'real-user')).toEqual([]);
  });

  it('keeps prior demo schedules out of a newly signed-in guest account', () => {
    const guestUid = 'guest_device_123';
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([
      post({ id: 'bakery', businessName: 'Mekong Bakery Test' }),
      post({ id: 'guest-copy', userId: guestUid, localOnly: true }),
    ]));
    expect(mergeStoredScheduleHistory([], guestUid)).toEqual([]);
  });

  it('always keeps schedules belonging to the current user and lets remote copies win', () => {
    const localCopy = post({ userId: 'real-user', status: 'PENDING' });
    const remoteCopy = post({ id: 'remote-post', userId: 'real-user', status: 'PUBLISHED' });
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([localCopy]));

    expect(mergeStoredScheduleHistory([remoteCopy], 'real-user')).toEqual([remoteCopy]);
  });

  it('drops another owner from local and remote records even when passed by mistake', () => {
    const mine = post({ id: 'mine', userId: 'real-user' });
    const other = post({ id: 'other', userId: 'other-user' });
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([mine, other]));
    expect(mergeStoredScheduleHistory([other, mine], 'real-user')).toEqual([mine]);
  });
});
