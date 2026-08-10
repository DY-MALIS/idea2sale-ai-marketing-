import { FieldValue } from 'firebase-admin/firestore';

// Best-effort audit trail for server-side actions that bypass Firestore rules
// (Admin SDK writes, TikTok/Telegram publishing). Never throws — a logging
// failure must not block the action it is recording.
export const logAudit = async (db, { action, actorUid = null, actorLabel = null, meta = {} }) => {
  try {
    await db.collection('audit_logs').add({
      action,
      actorUid,
      actorLabel,
      meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error(`Audit log write failed for action "${action}":`, error?.message || error);
  }
};
