import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';

const OWNED_COLLECTIONS = ['scheduled_posts', 'campaigns', 'reply_rules', 'audience_activity', 'tiktok_posts'];

const getAdminUsers = async (req, res) => {
  try {
    const db = initFirebaseAdmin();
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(403).json({ error: 'Admin access required.' });
    const decoded = await admin.auth().verifyIdToken(token, true);
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) return res.status(403).json({ error: 'Admin access required.' });

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
    return res.status(500).json({ error: error?.message || 'Could not load admin user data.' });
  }
};

export default async function handler(req, res) {
  if (req.query?.action === 'admin-users') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return getAdminUsers(req, res);
  }

  // SecurityCenter.tsx's Security Overview page tells users this endpoint "only
  // returns booleans (key present or not), never the values" -- it previously
  // returned the actual computed/configured TikTok redirect URI strings here,
  // contradicting that documented guarantee (low sensitivity in practice, since
  // redirect URIs are also visible during the OAuth flow itself, but the code
  // should match what the security page claims it does).
  res.status(200).json({
    tiktok: {
      hasClientKey: !!(process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY),
      hasClientSecret: !!(process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET),
      hasRedirectUri: !!(process.env.TIKTOK_REDIRECT_URI || process.env.VITE_TIKTOK_REDIRECT_URI),
    },
    firebase: {
      isInitialized: !!process.env.FIREBASE_PROJECT_ID,
    },
  });
}
