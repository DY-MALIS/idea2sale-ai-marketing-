import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmins } from './_alert.js';

describe('notifyAdmins', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('never throws and skips the network call when unconfigured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
    await expect(notifyAdmins('something broke')).resolves.toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends to the admin chat, not the public broadcast chat', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = 'admin-123';
    process.env.TELEGRAM_CHAT_ID = 'public-channel-456';
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await notifyAdmins('something broke');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('test-token');
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('admin-123');
    expect(body.text).toContain('something broke');
  });

  it('swallows a failed alert send instead of throwing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = 'admin-123';
    globalThis.fetch.mockRejectedValue(new Error('network down'));

    await expect(notifyAdmins('something broke')).resolves.toBeUndefined();
  });
});
