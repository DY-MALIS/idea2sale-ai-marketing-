import { describe, expect, it } from 'vitest';
import { telegramRetryPlan } from '../api/_telegramRetry.js';

describe('Telegram retry policy', () => {
  const temporary = { retrySafe: true, permanent: false };
  it('backs off exponentially and stops after four retries', () => {
    expect(telegramRetryPlan({}, temporary, 0)).toEqual({ retryCount: 1, nextAttemptAt: new Date(30000).toISOString() });
    expect(telegramRetryPlan({ retryCount: 2 }, temporary, 0)?.nextAttemptAt).toBe(new Date(120000).toISOString());
    expect(telegramRetryPlan({ retryCount: 4 }, temporary, 0)).toBeNull();
  });
  it('does not retry permissions or uncertain sends', () => {
    expect(telegramRetryPlan({}, { retrySafe: false, permanent: false })).toBeNull();
    expect(telegramRetryPlan({}, { retrySafe: true, permanent: true })).toBeNull();
  });
});
