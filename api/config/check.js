import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../_audit.js';
import { notifyAdmins } from '../_alert.js';

const OWNED_COLLECTIONS = ['scheduled_posts', 'campaigns', 'reply_rules', 'audience_activity', 'tiktok_posts'];
const BACKUP_COLLECTIONS = [
  ...OWNED_COLLECTIONS,
  'business_profiles', 'agent_conversations', 'telegram_leads', 'telegram_messages',
  'telegram_channel_engagement', 'settings', 'audit_logs',
];
const CLIENT_AUDIT_ACTIONS = new Set([
  'scheduled_post_status_updated', 'scheduled_post_deleted', 'scheduled_post_retried',
  'reply_rule_created', 'reply_rule_deleted', 'automation_status_changed',
  'scheduled_post_created', 'audience_activity_trained', 'business_profile_updated',
]);

const requireAdmin = async (req, db) => {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const decoded = await admin.auth().verifyIdToken(token, true);
  const adminDoc = await db.collection('admins').doc(decoded.uid).get();
  return adminDoc.exists ? decoded : null;
};

const encodeBackupValue = (value) => {
  if (value === null || value === undefined) return value ?? null;
  if (value?.toDate && typeof value.toDate === 'function') {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(encodeBackupValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeBackupValue(item)]));
  }
  return value;
};

const decodeBackupValue = (value) => {
  if (Array.isArray(value)) return value.map(decodeBackupValue);
  if (value && typeof value === 'object') {
    if (value.__type === 'timestamp' && typeof value.value === 'string') {
      const date = new Date(value.value);
      if (Number.isNaN(date.getTime())) throw new Error('Backup contains an invalid timestamp.');
      return Timestamp.fromDate(date);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeBackupValue(item)]));
  }
  return value;
};

const createAdminBackup = async (req, res) => {
  const db = initFirebaseAdmin();
  const actor = await requireAdmin(req, db);
  if (!actor) return res.status(403).json({ error: 'Admin access required.' });
  const snapshots = await Promise.all(BACKUP_COLLECTIONS.map((name) => db.collection(name).get()));
  const collections = {};
  BACKUP_COLLECTIONS.forEach((name, index) => {
    collections[name] = snapshots[index].docs.map((doc) => ({ id: doc.id, data: encodeBackupValue(doc.data()) }));
  });
  const documentCount = Object.values(collections).reduce((total, docs) => total + docs.length, 0);
  await logAudit(db, { action: 'admin_backup_downloaded', actorUid: actor.uid, actorLabel: actor.email || null, meta: { documentCount } });
  res.setHeader('Content-Disposition', `attachment; filename="aime-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  return res.status(200).json({ version: 1, createdAt: new Date().toISOString(), documentCount, collections });
};

const restoreAdminBackup = async (req, res) => {
  const db = initFirebaseAdmin();
  const actor = await requireAdmin(req, db);
  if (!actor) return res.status(403).json({ error: 'Admin access required.' });
  if (req.body?.confirmation !== 'RESTORE') return res.status(400).json({ error: 'Restore confirmation is required.' });
  const backup = req.body?.backup;
  if (backup?.version !== 1 || !backup.collections || typeof backup.collections !== 'object') {
    return res.status(400).json({ error: 'Unsupported or invalid backup file.' });
  }

  const writes = [];
  for (const collectionName of BACKUP_COLLECTIONS) {
    const documents = backup.collections[collectionName];
    if (documents === undefined) continue;
    if (!Array.isArray(documents)) return res.status(400).json({ error: `Invalid ${collectionName} backup data.` });
    for (const document of documents) {
      if (!document?.id || typeof document.id !== 'string' || document.id.includes('/')) {
        return res.status(400).json({ error: `Invalid document ID in ${collectionName}.` });
      }
      writes.push({ ref: db.collection(collectionName).doc(document.id), data: decodeBackupValue(document.data || {}) });
    }
  }
  if (writes.length > 5000) return res.status(413).json({ error: 'Backup contains too many documents for in-app restore.' });

  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    writes.slice(index, index + 400).forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
  }
  await logAudit(db, { action: 'admin_backup_restored', actorUid: actor.uid, actorLabel: actor.email || null, meta: { documentCount: writes.length } });
  await notifyAdmins(`Admin ${actor.email || actor.uid} restored ${writes.length} Firestore documents from an aime.angkorgate backup.`);
  return res.status(200).json({ ok: true, restored: writes.length });
};

const recordClientAudit = async (req, res) => {
  const db = initFirebaseAdmin();
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign-in required.' });
  const actor = await admin.auth().verifyIdToken(token, true);
  const action = String(req.body?.event || '');
  if (!CLIENT_AUDIT_ACTIONS.has(action)) return res.status(400).json({ error: 'Unsupported audit event.' });
  const rawMeta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
  const meta = Object.fromEntries(Object.entries(rawMeta).slice(0, 12).map(([key, value]) => [String(key).slice(0, 60), String(value ?? '').slice(0, 500)]));
  await logAudit(db, { action, actorUid: actor.uid, actorLabel: actor.email || null, meta });
  return res.status(200).json({ ok: true });
};

const getAutomationStats = async (req, res) => {
  const db = initFirebaseAdmin();
  const actor = await requireAdmin(req, db);
  if (!actor) return res.status(403).json({ error: 'Admin access required.' });
  const messages = db.collection('telegram_messages');
  const [incomingSnapshot, ruleSnapshot, aiSnapshot] = await Promise.all([
    messages.where('direction', '==', 'in').count().get(),
    messages.where('source', '==', 'rule').count().get(),
    messages.where('source', '==', 'ai').count().get(),
  ]);
  const incoming = incomingSnapshot.data().count || 0;
  const replies = (ruleSnapshot.data().count || 0) + (aiSnapshot.data().count || 0);
  return res.status(200).json({
    incoming,
    replies,
    hours: Math.round((replies * 1.5 / 60) * 10) / 10,
    rate: incoming > 0 ? Math.min(100, Math.round((replies / incoming) * 100)) : 0,
  });
};

const getAdminUsers = async (req, res) => {
  try {
    const db = initFirebaseAdmin();
    const decoded = await requireAdmin(req, db);
    if (!decoded) return res.status(403).json({ error: 'Admin access required.' });

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
  if (req.query?.action === 'admin-backup') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return createAdminBackup(req, res);
  }

  if (req.query?.action === 'admin-restore') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    return restoreAdminBackup(req, res);
  }

  if (req.query?.action === 'audit-event') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    return recordClientAudit(req, res);
  }

  if (req.query?.action === 'automation-stats') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return getAutomationStats(req, res);
  }

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
    alerts: {
      hasTelegramAdminChat: !!process.env.TELEGRAM_ADMIN_CHAT_ID,
    },
  });
}
