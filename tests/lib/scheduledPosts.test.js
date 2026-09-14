import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markDemoModeSession,
  mergeStoredScheduleHistory,
  wasDemoModeThisSession,
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
  vi.stubGlobal('sessionStorage', makeStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe('demo schedule carry-over', () => {
  it('does not expose an old demo user\'s local schedule to a later signed-in user', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([post()]));

    expect(wasDemoModeThisSession()).toBe(false);
    expect(mergeStoredScheduleHistory([], 'real-user')).toEqual([]);
  });

  it('carries demo schedules into an account created in the same session', () => {
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([post()]));
    markDemoModeSession();

    expect(wasDemoModeThisSession()).toBe(true);
    expect(mergeStoredScheduleHistory([], 'real-user')).toEqual([post()]);
  });

  it('always keeps schedules belonging to the current user and lets remote copies win', () => {
    const localCopy = post({ userId: 'real-user', status: 'PENDING' });
    const remoteCopy = post({ id: 'remote-post', userId: 'real-user', status: 'PUBLISHED' });
    localStorage.setItem('demo_scheduled_posts', JSON.stringify([localCopy]));

    expect(mergeStoredScheduleHistory([remoteCopy], 'real-user')).toEqual([remoteCopy]);
  });
});
