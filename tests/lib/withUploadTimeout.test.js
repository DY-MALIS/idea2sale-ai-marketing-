import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withUploadTimeout } from '../../src/lib/withUploadTimeout.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('withUploadTimeout', () => {
  it('returns an upload result that completes before the deadline', async () => {
    await expect(withUploadTimeout(Promise.resolve('uploaded'), undefined, 20))
      .resolves.toBe('uploaded');
  });

  it('rejects a stalled upload with the caller-facing message', async () => {
    const stalled = new Promise(() => {});
    const result = withUploadTimeout(stalled, 'Upload stalled.', 20);
    const rejection = expect(result).rejects.toThrow('Upload stalled.');

    await vi.advanceTimersByTimeAsync(20);
    await rejection;
  });
});
