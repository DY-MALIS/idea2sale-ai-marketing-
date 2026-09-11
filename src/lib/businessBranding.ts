import { doc, getDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import type { BusinessDirectoryEntry, BusinessProfileData } from '../types';

export interface BusinessBranding {
  businessName: string;
  logoDataUrl: string;
  directory: BusinessDirectoryEntry[];
}

const emptyBranding = (): BusinessBranding => ({ businessName: '', logoDataUrl: '', directory: [] });

// Read at the moment an asset/script is generated. The main tabs stay mounted
// while Business Profile is edited, so mount-time state otherwise becomes stale.
export async function getLatestBusinessBranding(user: User | null, isDemoMode: boolean): Promise<BusinessBranding> {
  try {
    let profile: Partial<BusinessProfileData> | null = null;
    if (isDemoMode || !user) {
      profile = JSON.parse(localStorage.getItem('demo_business_profile') || 'null');
    } else {
      const snapshot = await getDoc(doc(db, 'business_profiles', user.uid));
      profile = snapshot.exists() ? snapshot.data() as BusinessProfileData : null;
    }
    return {
      businessName: String(profile?.businessName || '').trim(),
      logoDataUrl: String(profile?.logoDataUrl || ''),
      directory: Array.isArray(profile?.directory) ? profile.directory : [],
    };
  } catch (error) {
    console.error('Failed to load the latest business branding:', error);
    return emptyBranding();
  }
}

export function ensureBusinessInInboxMessage(message: string, businessName: string): string {
  const text = String(message || '').trim();
  const name = String(businessName || '').trim();
  if (!name || text.toLocaleLowerCase().includes(name.toLocaleLowerCase())) return text;
  if (/[ក-៿]/u.test(text)) {
    const sender = `ខ្ញុំមកពី ${name}។ `;
    return /^សួស្តី/u.test(text)
      ? text.replace(/^(សួស្តី(?:បង|លោក|លោកស្រី)?[!,។]?\s*)/u, `$1${sender}`)
      : `សួស្តី! ${sender}${text}`;
  }
  return `Hello! I’m reaching out from ${name}. ${text}`;
}
