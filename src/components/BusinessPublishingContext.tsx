import React from 'react';
import type { User } from 'firebase/auth';
import { getLatestBusinessBranding, type BusinessBranding } from '../lib/businessBranding';

export default function BusinessPublishingContext({ user, isDemoMode, account }: { user: User | null; isDemoMode: boolean; account?: string }) {
  const [branding, setBranding] = React.useState<BusinessBranding | null>(null);
  React.useEffect(() => {
    let active = true;
    const refresh = () => { void getLatestBusinessBranding(user, isDemoMode).then(value => { if (active) setBranding(value); }); };
    setBranding(null);
    refresh();
    window.addEventListener('business-profile-updated', refresh);
    return () => { active = false; window.removeEventListener('business-profile-updated', refresh); };
  }, [user?.uid, isDemoMode]);
  if (!branding) return null;
  const mismatch = Boolean(account && branding.businessName && account.toLocaleLowerCase() !== branding.businessName.toLocaleLowerCase());
  return <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
    <div className="flex items-center gap-3">
      {branding.logoDataUrl && <img src={branding.logoDataUrl} alt={`${branding.businessName || 'Business'} logo`} className="h-9 w-9 rounded object-contain" />}
      <div><p>Active business: <strong>{branding.businessName || 'No profile name'}</strong></p>
        <p>Publishing account: <strong>{account || 'Not connected'}</strong></p></div>
    </div>
    {branding.websiteUrl && <p className="mt-1 truncate">Website: <a href={branding.websiteUrl} target="_blank" rel="noopener noreferrer" className="underline">{branding.websiteUrl}</a></p>}
    {mismatch && <p role="alert" className="mt-2 font-semibold text-amber-700 dark:text-amber-300">This content uses {branding.businessName} branding. Check the publishing account before posting.</p>}
  </div>;
}
