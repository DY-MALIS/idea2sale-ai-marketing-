import { describe, expect, it, vi } from 'vitest';
import { hasUnlimitedContentPlanGeneration, unlimitedContentPlanAccount } from '../../api/_contentPlanEntitlements.js';

describe('Content Plan unlimited account', () => {
  it('uses the Firebase Auth email of the designated UID', async () => {
    const getUser = vi.fn().mockResolvedValue({ email: 'DYMALIS88@gmail.com', disabled: false });
    const auth = { getUser };
    expect(await hasUnlimitedContentPlanGeneration('another-user', auth)).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
    expect(await hasUnlimitedContentPlanGeneration(unlimitedContentPlanAccount.uid, auth)).toBe(true);
    expect(getUser).toHaveBeenCalledWith(unlimitedContentPlanAccount.uid);
    getUser.mockResolvedValue({ email: 'someone-else@gmail.com', disabled: false });
    expect(await hasUnlimitedContentPlanGeneration(unlimitedContentPlanAccount.uid, auth)).toBe(false);
    getUser.mockResolvedValue({ email: unlimitedContentPlanAccount.email, disabled: true });
    expect(await hasUnlimitedContentPlanGeneration(unlimitedContentPlanAccount.uid, auth)).toBe(false);
  });
});
