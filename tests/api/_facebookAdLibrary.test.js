import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { searchCompetitorAds } from '../../api/_facebookAdLibrary.js';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, FACEBOOK_ACCESS_TOKEN: 'test-token' };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

it('reports missing Meta Ad Library permission with an actionable error code', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Application does not have permission for this action' } }),
  }));

  await expect(searchCompetitorAds({ searchTerms: 'business', countries: ['KH'] }))
    .rejects.toMatchObject({ code: 'facebook_permission_denied' });
});
