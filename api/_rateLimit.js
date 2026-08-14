import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

// Vercel puts the original client IP first in x-forwarded-for (a proxy chain
// appends its own, so later entries are less trustworthy) -- good enough to
// throttle abuse from a single connection without needing real user identity,
// which unauthenticated callers (guest mode, this endpoint's own callers) don't have.
export const getClientIp = (req) => {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
};

// Fixed-window counter in Firestore, keyed by caller-supplied scope + identifier
// (IP, guest id, etc) so different endpoints never share a budget. Admin SDK
// writes bypass firestore.rules -- no client can read or tamper with this.
export async function checkRateLimit(db, { scope, key, limit, windowMs = DEFAULT_WINDOW_MS }) {
  const bucket = Math.floor(Date.now() / windowMs);
  const docId = `${scope}_${key}_${bucket}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 400);
  const ref = db.collection('rate_limits').doc(docId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data()?.count || 0) : 0;
    if (count >= limit) {
      return { allowed: false, count, limit };
    }
    tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { allowed: true, count: count + 1, limit };
  });
}
