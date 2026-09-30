import type { User } from 'firebase/auth';

// Scheduled publishing uses the owner's stored automation token, not the
// browser's short-lived TikTok cookie. Check that connection before uploading
// media or moving a failed post back to PENDING.
export async function requireTikTokAutomationConnection(user: User): Promise<void> {
  const idToken = await user.getIdToken();
  const response = await fetch('/api/tiktok/me?action=automation', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not check your TikTok connection.');
  if (!data.connected) {
    throw new Error('Connect your own TikTok account in TikTok Activity before scheduling or retrying a TikTok post.');
  }
}
