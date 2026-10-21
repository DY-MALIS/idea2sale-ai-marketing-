import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDemoWorkspace } from '../../src/lib/demoWorkspace.ts';

afterEach(() => vi.unstubAllGlobals());

describe('demo workspace isolation', () => {
  it('removes previous visitor data while keeping signed-in account data', () => {
    const values = new Map([
      ['demo_business_profile', 'Old Company'],
      ['demo_scheduled_posts', 'Old schedule'],
      ['demo_agent_conversation', 'Old chat'],
      ['demo_generation_history_facebook_scan', 'Old scan'],
      ['copy_result_demo', 'Old demo copy'],
      ['tiktok_handle_demo', 'old_demo_handle'],
      ['copy_result_owner-a', 'Owner A copy'],
    ]);
    vi.stubGlobal('localStorage', { removeItem: (key) => values.delete(key) });
    clearDemoWorkspace();
    expect([...values]).toEqual([['copy_result_owner-a', 'Owner A copy']]);
  });
});
