import { auth } from './firebase';

export const recordAuditEvent = async (event: string, meta: Record<string, unknown> = {}) => {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    await fetch('/api/config/check?action=audit-event', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, meta }),
      keepalive: true,
    });
  } catch {
    // Audit reporting must not break the user action that already succeeded.
  }
};
