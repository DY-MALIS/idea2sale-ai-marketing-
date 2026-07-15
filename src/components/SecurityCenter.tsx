import React from 'react';
import { ShieldCheck, LockKeyhole, FileWarning, DatabaseBackup, Activity, Users, Bot, AlertTriangle } from 'lucide-react';

const readiness = [
  { label: 'Authentication and server-side route protection', status: 'Required', detail: 'All protected pages and API routes must validate the session before returning company data.' },
  { label: 'Company workspace isolation', status: 'RLS baseline added', detail: 'Supabase policies filter every sensitive table by active company membership.' },
  { label: 'Role-based access control', status: 'RLS baseline added', detail: 'Roles include super admin, company admin, manager, staff, viewer, and guest.' },
  { label: 'Secure file storage', status: 'Private bucket planned', detail: 'Confidential files use private Supabase Storage, signed URLs, and short expiry for sensitive levels.' },
  { label: 'AI permission filtering', status: 'Policy defined', detail: 'Semantic search must call match_allowed_file_chunks so the LLM only receives permitted chunks.' },
  { label: 'Audit logs', status: 'Schema added', detail: 'Sensitive view, download, AI query, permission change, and delete actions must be logged.' },
  { label: 'Backup and recovery', status: 'Documented', detail: 'Daily backups, recycle bin, version history, key rotation, and restore steps are documented.' },
  { label: 'Security tests', status: 'Documented', detail: 'TESTING.md covers auth, company isolation, file access, AI, search, audit, and recovery cases.' },
];

const governance = [
  'Owner, department, project, uploaded by, and responsible manager are required metadata.',
  'Confidentiality level controls signed URL expiry, download defaults, AI usage, and audit logging.',
  'Highly Confidential and Executive Only files require access approval and human review.',
  'Delete is soft-delete first; permanent delete requires admin permission, retention check, confirmation, and audit log.',
];

const monitoring = [
  'Upload success rate',
  'AI processing queue',
  'Permission errors',
  'Suspicious download activity',
  'Storage usage',
  'AI token usage',
  'Backup status placeholder',
  'Outdated documents',
];

const SecurityCenter: React.FC = () => {
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Admin Security</p>
          <h2 className="mt-2 text-4xl font-display font-bold text-slate-950">Production Readiness Center</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            This screen tracks the security controls required before confidential company data is used in production. The app should not be marked production-ready until RLS, storage access, AI filtering, and audit logging are verified.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Pilot mode only until security tests pass
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: ShieldCheck, label: 'RLS policies', value: 'Baseline added' },
          { icon: LockKeyhole, label: 'Private storage', value: 'Required' },
          { icon: Bot, label: 'AI access', value: 'Permission-filtered' },
          { icon: Activity, label: 'Audit logs', value: 'Sensitive actions' },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <item.icon className="h-5 w-5 text-brand-700" />
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-950">MVP Readiness Checklist</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {readiness.map((item) => (
            <div key={item.label} className="grid gap-3 px-6 py-4 md:grid-cols-[1fr_180px] md:items-center">
              <div>
                <p className="font-semibold text-slate-900">{item.label}</p>
                <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
              </div>
              <span className="w-fit rounded-md bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <FileWarning className="h-5 w-5 text-brand-700" />
          <h3 className="mt-4 text-lg font-bold text-slate-950">Data Governance</h3>
          <div className="mt-4 space-y-3">
            {governance.map((item) => (
              <p key={item} className="text-sm leading-6 text-slate-600">{item}</p>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <DatabaseBackup className="h-5 w-5 text-brand-700" />
          <h3 className="mt-4 text-lg font-bold text-slate-950">Backup and Recovery</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>Daily database backups and storage backup policy must be configured in Supabase before production.</p>
            <p>Deleted files enter recycle bin first. Version history keeps prior storage paths for restoration.</p>
            <p>README includes restore, storage recovery, key rotation, and compromised user response steps.</p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Users className="h-5 w-5 text-brand-700" />
          <h3 className="mt-4 text-lg font-bold text-slate-950">Human Approval</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>Human approval is required for sensitive classification, external sharing, permanent deletion, access requests, and AI-generated workflows.</p>
            <p>Approvers can set access expiry and revoke confidential file access at any time.</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-lg font-bold text-slate-950">Monitoring Placeholders</h3>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {monitoring.map((item) => (
            <div key={item} className="rounded-md border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default SecurityCenter;
