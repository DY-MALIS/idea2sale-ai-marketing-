import React, { useEffect, useState } from 'react';
import { ShieldCheck, LockKeyhole, FileWarning, DatabaseBackup, Activity, Users, Bot, AlertTriangle, ListChecks, ShieldAlert, Loader2 } from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot, DocumentData } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { useIsAdmin } from '../hooks/useIsAdmin';

type ControlStatus = 'live' | 'partial' | 'missing';

interface Control {
  label: string;
  status: ControlStatus;
  detail: string;
}

const statusMeta: Record<ControlStatus, { text: string; className: string }> = {
  live: { text: 'Live', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  partial: { text: 'Partial', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  missing: { text: 'Not implemented', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

const controls: Control[] = [
  {
    label: 'Default-deny Firestore rules',
    status: 'live',
    detail: 'firestore.rules denies every path by default; each collection below is explicitly opened.',
  },
  {
    label: 'Per-user data isolation',
    status: 'live',
    detail: 'scheduled_posts, campaigns, reply_rules, audience_activity, and business_profiles only allow read/write where userId == the signed-in uid.',
  },
  {
    label: 'Shared Telegram CRM and inbox',
    status: 'live',
    detail: 'telegram_leads and telegram_messages are readable by admins only (admins/{uid} must exist) — there is one shared Telegram bot for every business using this deployment, so this is a trusted shared workspace, not per-business isolation. Writes are server-only (Admin SDK).',
  },
  {
    label: 'Public TikTok analytics read',
    status: 'live',
    detail: 'tiktok_posts is private: admins can read all records, while signed-in users can read only records whose userId matches their own account. Anonymous and cross-account reads are denied.',
  },
  {
    label: 'Admin-gated deletes',
    status: 'partial',
    detail: 'Deleting a tiktok_posts doc, and reading the Telegram CRM/inbox, both require an admins/{uid} Firestore document. Run `npm run grant-admin -- <email-or-uid>` to create one — still a manual step, just no longer a hand-edit in the Firebase console.',
  },
  {
    label: 'Server secrets never sent to client',
    status: 'live',
    detail: 'TikTok, Cloudinary, OpenRouter, and Firebase Admin credentials stay in serverless functions. /api/config/check only returns booleans (key present or not), never the values.',
  },
  {
    label: 'Scheduled/cron endpoint authentication',
    status: 'live',
    detail: 'api/telegram/run-scheduled.js now refuses to run at all if CRON_SECRET is not configured (fails closed). Vercel Cron sends it automatically once the env var is set; .github/workflows/telegram-scheduler.yml sends it from a GitHub repo secret of the same name.',
  },
  {
    label: 'Audit logging',
    status: 'partial',
    detail: 'audit_logs (admin-only read, server-only write) records manual Telegram replies, TikTok publish attempts, and cron run summaries — see the Recent Activity panel below. It does not yet cover every write in the app (e.g. scheduled post edits, reply rule changes).',
  },
  {
    label: 'Backup and restore',
    status: 'missing',
    detail: 'No documented or verified backup policy for this Firebase project. Firestore point-in-time recovery / scheduled exports must be enabled manually in the Firebase console, and a restore should be test-run at least once — this cannot be done from application code.',
  },
];

const monitoring = [
  'Telegram scheduled post failures',
  'TikTok publish errors (missing video.upload/video.publish scope)',
  'AI API failures (OpenRouter / Gemini)',
  'Cloudinary upload failures',
  'Firestore rule denials',
  'Unusual Firebase Auth sign-in activity',
];

const SecurityCenter: React.FC = () => {
  const liveCount = controls.filter((c) => c.status === 'live').length;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Admin Security</p>
          <h2 className="mt-2 text-4xl font-display font-bold text-slate-950 dark:text-slate-100">Security Overview</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            This app is a single Firebase project (Firestore + Firebase Auth), not a multi-company system with row-level
            security. It is appropriate for one business/team using it as one shared workspace. It is not yet safe for
            hosting multiple unrelated companies' confidential data under one deployment.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-sm font-semibold text-amber-900 dark:text-amber-300">
          {liveCount}/{controls.length} controls fully live — review "Partial" and "Not implemented" rows before handling sensitive data
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: ShieldCheck, label: 'Firestore rules', value: 'Default-deny + owner checks' },
          { icon: LockKeyhole, label: 'Secrets', value: 'Server-side only' },
          { icon: Bot, label: 'AI keys', value: 'Not exposed to client' },
          { icon: Activity, label: 'Audit logs', value: 'Partial coverage' },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <item.icon className="h-5 w-5 text-brand-700 dark:text-brand-400" />
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-400">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-slate-950 dark:text-slate-100">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-100 px-6 py-4 flex items-center gap-2 dark:border-slate-700">
          <ListChecks className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">Access Control Checklist</h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {controls.map((item) => (
            <div key={item.label} className="grid gap-3 px-6 py-4 md:grid-cols-[1fr_160px] md:items-center">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.detail}</p>
              </div>
              <span className={`w-fit rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusMeta[item.status].className}`}>
                {statusMeta[item.status].text}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <FileWarning className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          <h3 className="mt-4 text-lg font-bold text-slate-950 dark:text-slate-100">Data Model</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <p>Most collections are owned by a single userId and are only readable/writable by that user.</p>
            <p>The Telegram CRM (leads and messages) is shared across every admin — one bot, one shared inbox, not a multi-tenant one. Non-admins get no access at all.</p>
            <p>There is no company/workspace concept in the data model today.</p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <DatabaseBackup className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          <h3 className="mt-4 text-lg font-bold text-slate-950 dark:text-slate-100">Backup and Recovery</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <p>No backup schedule has been verified for this Firebase project. This is a Firebase console setting — nothing in this codebase can enable or verify it for you.</p>
            <p>To fix: Firebase console → Firestore Database → Backups → schedule daily/weekly exports to Cloud Storage, then actually restore one export into a scratch project to confirm it works before trusting it.</p>
            <p>Deleted records are not soft-deleted anywhere in the app — deletes are permanent.</p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <Users className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          <h3 className="mt-4 text-lg font-bold text-slate-950 dark:text-slate-100">Admin Access</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <p>Admin status is checked via an admins/{'{uid}'} Firestore document. There is still no in-app UI to create one (by design — it's a sensitive, rare action).</p>
            <p>To grant admin (needed for the Telegram CRM/inbox and deleting tiktok_posts records), run <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-700">npm run grant-admin -- someone@example.com</code> from the server environment.</p>
          </div>
        </div>
      </section>

      <AdminUserDataPanel />
      <AuditLogPanel />

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">Worth Monitoring</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          None of these are wired to alerts yet — check them manually (Vercel logs, Firebase console) until real monitoring is added.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {monitoring.map((item) => (
            <div key={item} className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

interface AdminUserSummary {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  businessName?: string | null;
  disabled: boolean;
  isAdmin: boolean;
  createdAt?: string | null;
  lastSignInAt?: string | null;
  agentMessageCount: number;
  dataCounts: Record<string, number>;
}

const AdminUserDataPanel: React.FC = () => {
  const { isAdmin, checking } = useIsAdmin();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (checking) return;
    if (!isAdmin || !auth.currentUser) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadUsers = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const response = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load users.');
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch (loadError: any) {
        if (loadError?.name !== 'AbortError') setError(loadError?.message || 'Could not load users.');
      } finally {
        setLoading(false);
      }
    };
    void loadUsers();
    return () => controller.abort();
  }, [checking, isAdmin]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <Users className="h-5 w-5 text-brand-700 dark:text-brand-400" />
        <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">Admin User Data</h3>
      </div>
      {checking || loading ? (
        <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-brand-400" /></div>
      ) : !isAdmin ? (
        <p className="px-6 py-8 text-sm text-slate-500">Admin access required.</p>
      ) : error ? (
        <p className="px-6 py-8 text-sm text-red-600">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-6 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Scheduled</th>
                <th className="px-4 py-3">Campaigns</th>
                <th className="px-4 py-3">Rules</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">AI messages</th>
                <th className="px-4 py-3">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {users.map((item) => (
                <tr key={item.uid}>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{item.email || item.displayName || 'No email'}</p>
                    <p className="mt-1 max-w-64 truncate text-xs text-slate-400" title={item.uid}>{item.businessName || item.uid}</p>
                  </td>
                  <td className="px-4 py-4 font-semibold text-brand-700 dark:text-brand-400">{item.isAdmin ? 'Admin' : 'User'}</td>
                  <td className="px-4 py-4">{item.dataCounts.scheduled_posts || 0}</td>
                  <td className="px-4 py-4">{item.dataCounts.campaigns || 0}</td>
                  <td className="px-4 py-4">{item.dataCounts.reply_rules || 0}</td>
                  <td className="px-4 py-4">{item.dataCounts.audience_activity || 0}</td>
                  <td className="px-4 py-4">{item.agentMessageCount || 0}</td>
                  <td className="px-4 py-4 text-xs text-slate-500">{item.lastSignInAt ? new Date(item.lastSignInAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

interface AuditLogEntry {
  id: string;
  action: string;
  actorUid?: string | null;
  actorLabel?: string | null;
  meta?: DocumentData;
  createdAt?: { toDate: () => Date };
}

const ACTION_LABELS: Record<string, string> = {
  telegram_manual_reply: 'Sent a manual Telegram CRM reply',
  tiktok_publish_photo: 'Published a TikTok photo post',
  tiktok_publish_video: 'Published a TikTok video post',
  telegram_cron_run: 'Scheduled Telegram poster ran',
};

const AuditLogPanel: React.FC = () => {
  const { isAdmin, checking } = useIsAdmin();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (checking || !isAdmin) {
      setLoading(false);
      return;
    }
    const q = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as AuditLogEntry[]);
      setLoading(false);
    }, (error) => {
      console.error('Audit log listener error:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [checking, isAdmin]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b border-slate-100 px-6 py-4 flex items-center gap-2 dark:border-slate-700">
        <Activity className="h-5 w-5 text-brand-700 dark:text-brand-400" />
        <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">Recent Activity</h3>
      </div>
      {checking || loading ? (
        <div className="flex justify-center p-10">
          <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
        </div>
      ) : !isAdmin ? (
        <div className="flex items-center gap-3 px-6 py-8 text-sm text-slate-500 dark:text-slate-400">
          <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0" />
          Admin access required to view the audit log.
        </div>
      ) : logs.length === 0 ? (
        <p className="px-6 py-8 text-sm text-slate-500 dark:text-slate-400">
          No audited actions yet — this fills in as Telegram replies, TikTok publishes, and cron runs happen.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {logs.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {ACTION_LABELS[entry.action] || entry.action}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-400">
                  {entry.actorLabel || entry.actorUid || 'unknown actor'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-400">
                {entry.createdAt?.toDate ? entry.createdAt.toDate().toLocaleString() : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default SecurityCenter;
