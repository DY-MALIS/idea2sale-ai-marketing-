import admin from './_firebaseAdmin.js';

// Firebase Auth is the source of truth for this account. The UID guard avoids
// looking up every customer's email on each scheduled generation claim.
export const unlimitedContentPlanAccount = {
  uid: 'BDMKG04fF0auK9Zfs0tx6TmWE7J2',
  email: 'dymalis88@gmail.com',
};

export async function hasUnlimitedContentPlanGeneration(userId, auth) {
  if (userId !== unlimitedContentPlanAccount.uid) return false;
  const user = await (auth || admin.auth()).getUser(userId);
  return user.disabled !== true
    && String(user.email || '').trim().toLowerCase() === unlimitedContentPlanAccount.email;
}
