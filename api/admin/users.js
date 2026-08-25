import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';

const OWNED_COLLECTIONS = ['scheduled_posts', 'campaigns', 'reply_rules', 'audience_activity', 'tiktok_posts'];

const requireAdmin = async (req, db) => {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const decoded = await admin.auth().verifyIdToken(token, true);
  const adminDoc = await db.collection('admins').doc(decoded.uid).get();
  return adminDoc.exists ? decoded : null;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = initFirebaseAdmin();
    const requester = await requireAdmin(req, db);
    if (!requester) return res.status(403).json({ error: 'Admin access required.' });

    const [authResult, adminSnapshot, profileSnapshot, conversationSnapshot, ...ownedSnapshots] = await Promise.all([
      admin.auth().listUsers(1000),
      db.collection('admins').get(),
      db.collection('business_profiles').get(),
      db.collection('agent_conversations').get(),
      ...OWNED_COLLECTIONS.map((name) => db.collection(name).get()),
    ]);

    const adminIds = new Set(adminSnapshot.docs.map((doc) => doc.id));
    const profiles = new Map(profileSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const conversations = new Map(conversationSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const counts = new Map();

    OWNED_COLLECTIONS.forEach((collectionName, index) => {
      ownedSnapshots[index].docs.forEach((doc) => {
        const uid = doc.data()?.userId;
        if (!uid) return;
        const current = counts.get(uid) || {};
        current[collectionName] = (current[collectionName] || 0) + 1;
        counts.set(uid, current);
      });
    });

    const users = authResult.users.map((user) => {
      const profile = profiles.get(user.uid) || {};
      const conversation = conversations.get(user.uid) || {};
      return {
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || profile.businessName || null,
        disabled: user.disabled,
        isAdmin: adminIds.has(user.uid),
        createdAt: user.metadata.creationTime || null,
        lastSignInAt: user.metadata.lastSignInTime || null,
        businessName: profile.businessName || null,
        agentMessageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
        dataCounts: counts.get(user.uid) || {},
      };
    });

    return res.status(200).json({ users, total: users.length });
  } catch (error) {
    const status = /token|auth|credential/i.test(String(error?.message || '')) ? 401 : 500;
    return res.status(status).json({ error: error?.message || 'Could not load admin user data.' });
  }
}
