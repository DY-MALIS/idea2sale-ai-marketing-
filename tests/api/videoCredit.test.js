import { afterEach, expect, it, vi } from 'vitest';
import { assertVideoCreditAvailable } from '../../api/_videoCredit.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('rejects an exhausted account before a video job is submitted', async () => {
  vi.stubEnv('OPEN_ROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { total_credits: 10, total_usage: 10.08 } }),
  }));
  await expect(assertVideoCreditAvailable()).rejects.toMatchObject({
    statusCode: 402,
    videoStartNotSubmitted: true,
  });
});

it('does not turn a credits API outage into a video outage', async () => {
  vi.stubEnv('OPEN_ROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
  await expect(assertVideoCreditAvailable()).resolves.toBeUndefined();
});

it('allows an account with remaining credit', async () => {
  vi.stubEnv('OPEN_ROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { total_credits: 10, total_usage: 9.5 } }),
  }));
  await expect(assertVideoCreditAvailable()).resolves.toBeUndefined();
});
