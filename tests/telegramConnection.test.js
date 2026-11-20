import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyTelegramError, validateTelegramConnection } from '../api/_telegramConnection.js';

const response = (result, status = 200) => ({ ok: status < 400, status, json: async () => status < 400 ? { ok: true, result } : { ok: false, description: result } });
const mockChecks = (member = { status: 'administrator', can_post_messages: true }) => {
  globalThis.fetch = vi.fn()
    .mockResolvedValueOnce(response({ id: 15, username: 'testbot' }))
    .mockResolvedValueOnce(response({ id: -10045, type: 'channel', title: 'Test' }))
    .mockResolvedValueOnce(response(member));
};

afterEach(() => vi.restoreAllMocks());

describe('Telegram connection preflight', () => {
  it('accepts a posting administrator without sending a message', async () => {
    mockChecks();
    expect(await validateTelegramConnection({ token: 'test-token', chatId: '-10045' })).toMatchObject({ ready: true, channelId: '-10045' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(globalThis.fetch.mock.calls.map(([url]) => String(url).split('/').pop())).toEqual(['getMe', 'getChat', 'getChatMember']);
  });
  it.each([
    ['chat not found', 400, 'CHANNEL_NOT_FOUND'],
    ['Forbidden: bot is not a member of the channel chat', 403, 'BOT_NOT_MEMBER'],
    ['not enough rights to send messages', 403, 'MISSING_PERMISSION'],
    ['Unauthorized', 401, 'INVALID_TOKEN'],
  ])('classifies %s', (message, status, code) => {
    expect(classifyTelegramError(message, status).code).toBe(code);
  });
  it('rejects a bot without posting rights', async () => {
    mockChecks({ status: 'administrator', can_post_messages: false });
    await expect(validateTelegramConnection({ token: 'test-token', chatId: '-10045' })).rejects.toMatchObject({ code: 'MISSING_PERMISSION' });
  });
  it('keeps an unconfirmed send unsafe to retry', () => {
    expect(classifyTelegramError('network error', 0, { sendAttempted: true })).toMatchObject({ code: 'SEND_UNCERTAIN', retrySafe: false });
  });
});
