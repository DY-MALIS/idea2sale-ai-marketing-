import { afterEach, expect, it, vi } from 'vitest';
import { getScheduledCallbackBaseUrl } from '../../api/_callbackUrl.js';

afterEach(() => vi.unstubAllEnvs());

it('uses the configured production origin for signed callbacks', () => {
  vi.stubEnv('APP_URL', 'https://app.example.com/marketing');
  expect(getScheduledCallbackBaseUrl()).toBe('https://app.example.com');
});

it('rejects a local or insecure callback destination', () => {
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  expect(() => getScheduledCallbackBaseUrl()).toThrow('public HTTPS origin');
});
