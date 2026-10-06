import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, FileText, Building2, User, Plus, Trash2, Save, CheckCircle2, Loader2, Send, Bot, ArrowRight } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { BusinessDirectoryEntry, BusinessProfileData } from '../types';
import { recordAuditEvent } from '../lib/auditClient';
import { withUploadTimeout } from '../lib/withUploadTimeout';
import { channelUsernameFromProfile } from '../../shared/telegramDestination.js';

const DEMO_STORAGE_KEY = 'demo_business_profile';
const LOGO_MAX_DIMENSION = 256;

const validHttpUrl = (value: string, allowedHosts?: string[]): boolean => {
  try {
    if (value.length > 300 || /\s/.test(value)) return false;
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username && !parsed.password
      && (!allowedHosts || (parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname.toLowerCase())));
  } catch {
    return false;
  }
};

const getLocalProfile = (): BusinessProfileData => {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || 'null');
    if (saved) return saved;
  } catch {
    // fall through to default
  }
  return { businessName: '', logoDataUrl: '', directory: [], telegramBotToken: '', telegramChatId: '' };
};

const resizeImageToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load this image file.'));
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process this image file.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

const INTRO_FILE_MAX_BYTES = 8 * 1024 * 1024;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this file.'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });

interface BusinessProfileProps {
  onClose: () => void;
}

const BusinessProfile: React.FC<BusinessProfileProps> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const { user, isDemoMode, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const introFileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [introUploading, setIntroUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramBotActive, setTelegramBotActive] = useState(false);
  const [activatingBot, setActivatingBot] = useState(false);
  const [botStatusMessage, setBotStatusMessage] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [directory, setDirectory] = useState<BusinessDirectoryEntry[]>([]);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [savedTelegramBotToken, setSavedTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramChannelUrl, setTelegramChannelUrl] = useState('');
  const [tiktokHandle, setTiktokHandle] = useState('');
  const [facebookPageUrl, setFacebookPageUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');

  const [entryName, setEntryName] = useState('');
  const [entryType, setEntryType] = useState<'COMPANY' | 'INDIVIDUAL'>('COMPANY');

  useEffect(() => {
    // Waiting for Firebase auth to actually settle avoids a load-then-reload: this
    // modal can open before auth resolves, so `user` reads null for a moment even
    // for a signed-in visitor. Loading the demo/local profile during that window,
    // then re-loading real Firestore data once auth resolves a beat later, would
    // silently discard anything the user typed in between.
    if (authLoading) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setBusinessName(''); setBusinessDescription(''); setLogoDataUrl(''); setDirectory([]);
      setTelegramBotToken(''); setTelegramChatId(''); setTelegramChannelUrl('');
      setSavedTelegramBotToken('');
      setTiktokHandle(''); setFacebookPageUrl(''); setWebsiteUrl(''); setLinkedinUrl(''); setTelegramBotActive(false);
      try {
        if (isDemoMode || !user) {
          const local = getLocalProfile();
          if (cancelled) return;
          setBusinessName(local.businessName);
          setBusinessDescription(local.businessDescription || '');
          setLogoDataUrl(local.logoDataUrl);
          setDirectory(local.directory || []);
          setTelegramBotToken(local.telegramBotToken || '');
          setSavedTelegramBotToken(local.telegramBotToken || '');
          setTelegramChatId(local.telegramChatId || '');
          setTelegramChannelUrl(local.telegramChannelUrl || '');
          setTiktokHandle(local.tiktokHandle || '');
          setFacebookPageUrl(local.facebookPageUrl || '');
          setWebsiteUrl(local.websiteUrl || '');
          setLinkedinUrl(local.linkedinUrl || '');
        } else {
          const snap = await getDoc(doc(db, 'business_profiles', user.uid));
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data() as BusinessProfileData & { telegramBotActive?: boolean };
            setBusinessName(data.businessName || '');
            setBusinessDescription(data.businessDescription || '');
            setLogoDataUrl(data.logoDataUrl || '');
            setDirectory(data.directory || []);
            setTelegramBotToken(data.telegramBotToken || '');
            setSavedTelegramBotToken(data.telegramBotToken || '');
            setTelegramChatId(data.telegramChatId || '');
            setTelegramChannelUrl(data.telegramChannelUrl || '');
            setTiktokHandle(data.tiktokHandle || '');
            setFacebookPageUrl(data.facebookPageUrl || '');
            setWebsiteUrl(data.websiteUrl || '');
            setLinkedinUrl(data.linkedinUrl || '');
            setTelegramBotActive(Boolean(data.telegramBotActive));
          } else {
            setBusinessName(''); setBusinessDescription(''); setLogoDataUrl(''); setDirectory([]);
            setTelegramBotToken(''); setTelegramChatId(''); setTelegramChannelUrl('');
            setSavedTelegramBotToken('');
            setTiktokHandle(''); setFacebookPageUrl(''); setWebsiteUrl(''); setLinkedinUrl(''); setTelegramBotActive(false);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load business profile:', err);
        setError(t('businessProfileLoadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user, isDemoMode, authLoading]);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setLogoDataUrl(dataUrl);
    } catch (err: any) {
      setError(err.message || t('businessProfileLoadError'));
    }
  };

  const handleIntroFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > INTRO_FILE_MAX_BYTES) {
      setError(language === 'km' ? 'ឯកសារនេះធំពេក (កំណត់ត្រឹម ៨MB)។' : 'That file is too large (8 MB limit).');
      return;
    }
    setIntroUploading(true);
    setError(null);
    try {
      const fileDataUrl = await readFileAsDataUrl(file);
      const response = await withUploadTimeout(fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extractBusinessIntro', fileDataUrl, fileName: file.name, language }),
      }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not read this file.');
      setBusinessDescription(String(data.businessDescription || ''));
    } catch (err: any) {
      setError(err.message || t('businessProfileLoadError'));
    } finally {
      setIntroUploading(false);
    }
  };

  const handleWebsiteIntroSubmit = async () => {
    const url = websiteUrl.trim();
    if (!url) return;
    if (!validHttpUrl(url)) {
      setError(language === 'km' ? 'សូមបញ្ចូល link ដែលចាប់ផ្តើមដោយ http:// ឬ https://' : 'Enter a link starting with http:// or https://');
      return;
    }
    setIntroUploading(true);
    setError(null);
    try {
      const response = await withUploadTimeout(fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extractBusinessIntro', websiteUrl: url, language }),
      }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not read this website.');
      setBusinessDescription(String(data.businessDescription || ''));
    } catch (err: any) {
      setError(err.message || t('businessProfileLoadError'));
    } finally {
      setIntroUploading(false);
    }
  };

  const handleAddEntry = () => {
    const name = entryName.trim();
    if (!name) return;
    setDirectory((prev) => [
      ...prev,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, type: entryType }
    ]);
    setEntryName('');
  };

  const handleRemoveEntry = (id: string) => {
    setDirectory((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleSave = async () => {
    const channelInput = telegramChannelUrl.trim();
    const channelUsername = channelUsernameFromProfile(channelInput);
    if (channelInput && !channelUsername) {
      setError('Enter a public Telegram channel username such as @mycompany or https://t.me/mycompany.');
      return;
    }
    const channelUrl = channelUsername ? `https://t.me/${channelUsername.slice(1)}` : '';
    const pageUrl = facebookPageUrl.trim();
    if (pageUrl && !validHttpUrl(pageUrl, ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com'])) {
      setError('Enter a Facebook Page URL beginning with https://facebook.com/');
      return;
    }
    const siteUrl = websiteUrl.trim();
    if (siteUrl && !validHttpUrl(siteUrl)) {
      setError(language === 'km' ? 'សូមបញ្ចូល Website link ត្រឹមត្រូវ ដែលចាប់ផ្តើមដោយ https:// ឬ http://' : 'Enter a valid website URL starting with https:// or http:// (up to 300 characters).');
      return;
    }
    const linkedInPageUrl = linkedinUrl.trim();
    if (linkedInPageUrl && !validHttpUrl(linkedInPageUrl, ['linkedin.com', 'www.linkedin.com'])) {
      setError(language === 'km' ? 'សូមបញ្ចូល LinkedIn link ត្រឹមត្រូវ ដែលចាប់ផ្តើមដោយ https://linkedin.com/' : 'Enter a LinkedIn URL beginning with https://linkedin.com/ (up to 300 characters).');
      return;
    }
    if (tiktokHandle.trim() && !/^@?[A-Za-z0-9._]{1,100}$/.test(tiktokHandle.trim())) {
      setError('Enter only your TikTok username, such as @mycompany.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const profile: BusinessProfileData = {
      businessName: businessName.trim(),
      businessDescription: businessDescription.trim().slice(0, 1000),
      logoDataUrl,
      directory,
      telegramBotToken: telegramBotToken.trim(),
      telegramChatId: telegramChatId.trim(),
      telegramChannelUrl: channelUrl,
      tiktokHandle: tiktokHandle.trim().replace(/^@/, ''),
      facebookPageUrl: facebookPageUrl.trim(),
      websiteUrl: siteUrl,
      linkedinUrl: linkedInPageUrl,
    };
    try {
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(profile));
      } else {
        if (telegramBotActive && profile.telegramBotToken !== savedTelegramBotToken) {
          const idToken = await user.getIdToken();
          const response = await fetch('/api/telegram/webhook?action=activate-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ deactivate: true }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.ok) throw new Error(data.error || 'Could not disconnect the previous Telegram bot.');
          setTelegramBotActive(false);
        }
        // merge: true -- a plain overwrite here would wipe out telegramBotActive,
        // which the server sets independently (see activateOwnBot in
        // api/telegram/webhook.js) whenever the user activates/deactivates their
        // own bot, not through this form.
        await setDoc(doc(db, 'business_profiles', user.uid), {
          ...profile,
          userId: user.uid,
          updatedAt: serverTimestamp()
        }, { merge: true });
        void recordAuditEvent('business_profile_updated', {
          businessName: profile.businessName,
          directoryEntries: profile.directory.length,
          hasLogo: Boolean(profile.logoDataUrl),
        });
      }
      setSavedTelegramBotToken(profile.telegramBotToken);
      setSaved(true);
      window.dispatchEvent(new Event('business-profile-updated'));
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      console.error('Failed to save business profile:', err);
      setError(err.message || t('businessProfileSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBotActive = async () => {
    if (!user || isDemoMode) return;
    if (telegramBotToken.trim() !== savedTelegramBotToken) {
      setBotStatusMessage('Save the changed Bot Token before activating or deactivating the bot.');
      return;
    }
    setActivatingBot(true);
    setBotStatusMessage(null);
    const deactivate = telegramBotActive;
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/telegram/webhook?action=activate-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ deactivate }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Could not update your bot.');
      }
      setTelegramBotActive(Boolean(data.active));
      setBotStatusMessage(data.message || null);
    } catch (err: any) {
      setBotStatusMessage(err.message || 'Could not update your bot.');
    } finally {
      setActivatingBot(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[2rem] border border-white/50 shadow-2xl p-8"
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-display font-bold text-brand-700 dark:text-brand-400 tracking-tight">
              {t('businessProfileTitle')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('businessProfileDesc')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-brand-50 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="animate-spin text-brand-300" size={28} />
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-2xl bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="text-brand-300" size={28} />
                )}
              </div>
              <div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-600 dark:text-brand-400 rounded-xl text-sm font-bold transition-colors"
                >
                  <Upload size={16} />
                  {logoDataUrl ? t('changeLogo') : t('uploadLogo')}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">
                {t('businessName')}
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder={t('businessNamePlaceholder')}
                className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block" htmlFor="business-description">
                {language === 'km' ? 'អាជីវកម្មរបស់អ្នកលក់អ្វី?' : 'What does your business sell?'}
              </label>
              <textarea
                id="business-description"
                value={businessDescription}
                onChange={(event) => setBusinessDescription(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder={language === 'km' ? 'ឧទាហរណ៍៖ ហាងកាហ្វេ និងម៉ាត លក់ភេសជ្ជៈ និងទំនិញប្រចាំថ្ងៃ' : 'For example: a cafe and mini mart selling drinks and everyday goods'}
                className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
              />
              <input ref={introFileInputRef} type="file" className="hidden" onChange={handleIntroFileChange} />
              <button
                type="button"
                onClick={() => introFileInputRef.current?.click()}
                disabled={introUploading}
                className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-600 dark:text-brand-400 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {introUploading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {introUploading
                  ? (language === 'km' ? 'កំពុងអាន...' : 'Reading file...')
                  : (language === 'km' ? 'ឬ Upload ឯកសារណែនាំក្រុមហ៊ុន (.txt, .pdf, .docx, .json, .js, .html...)' : 'Or upload a company intro file (.txt, .pdf, .docx, .json, .js, .html...)')}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">
                  {language === 'km' ? 'តំណភ្ជាប់អាជីវកម្ម (ជាជម្រើស)' : 'Business links (optional)'}
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'km' ? 'បញ្ចូលតំណភ្ជាប់ ហើយចុច រក្សាទុកព័ត៌មាន ខាងក្រោម ដើម្បីរក្សាទុកទាំង ៣។' : 'Enter your links, then click Save Profile below to keep them.'}
                </p>
              </div>
              <div>
                <label htmlFor="business-facebook-url" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Facebook</label>
                <input id="business-facebook-url" type="url" inputMode="url" value={facebookPageUrl}
                  onChange={(e) => setFacebookPageUrl(e.target.value)} placeholder="https://www.facebook.com/mycompany"
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20" />
              </div>
              <div>
                <label htmlFor="business-website-url" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Website</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input id="business-website-url" type="url" inputMode="url" value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://your-website.com"
                    className="min-w-0 flex-1 px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20" />
                  <button type="button" onClick={() => void handleWebsiteIntroSubmit()} disabled={introUploading || !websiteUrl.trim()}
                    className="flex items-center justify-center gap-1.5 px-4 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {introUploading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    {language === 'km' ? 'ទាញយកព័ត៌មាន' : 'Fetch intro'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {language === 'km' ? 'ទាញយកព័ត៌មាន បំពេញការណែនាំខាងលើ។ តំណភ្ជាប់ត្រូវរក្សាទុកពេលចុច រក្សាទុកព័ត៌មាន។' : 'Fetch intro fills the description above. Save Profile stores the link.'}
                </p>
              </div>
              <div>
                <label htmlFor="business-linkedin-url" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">LinkedIn</label>
                <input id="business-linkedin-url" type="url" inputMode="url" value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://www.linkedin.com/company/mycompany"
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">
                {t('directoryTitle')}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('directoryDesc')}</p>

              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={entryName}
                  onChange={(e) => setEntryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEntry()}
                  placeholder={t('entryNamePlaceholder')}
                  className="flex-1 px-4 py-2.5 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                />
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as 'COMPANY' | 'INDIVIDUAL')}
                  className="px-3 py-2.5 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                >
                  <option value="COMPANY">{t('entryTypeCompany')}</option>
                  <option value="INDIVIDUAL">{t('entryTypeIndividual')}</option>
                </select>
                <button
                  onClick={handleAddEntry}
                  disabled={!entryName.trim()}
                  className="p-2.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div className="space-y-2">
                {directory.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">{t('noDirectoryEntries')}</p>
                ) : (
                  directory.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 bg-brand-50/50 dark:bg-slate-800/50 border border-brand-100 dark:border-slate-700 rounded-xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-white dark:bg-slate-900 text-brand-500 shrink-0">
                          {entry.type === 'COMPANY' ? <Building2 size={16} /> : <User size={16} />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-brand-700 dark:text-slate-100 line-clamp-1">{entry.name}</p>
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                            {entry.type === 'COMPANY' ? t('entryTypeCompany') : t('entryTypeIndividual')}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveEntry(entry.id)}
                        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest block">
                {language === 'km' ? 'ព័ត៌មាន TikTok (ជាជម្រើស)' : 'TikTok details (optional)'}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'km'
                  ? 'បើអ្នកបានភ្ជាប់ TikTok តាម TikTok Activity រួច អ្នកមិនចាំបាច់បញ្ចូលឈ្មោះគណនីនៅទីនេះទៀតទេ។ ប្រអប់នេះប្រើសម្រាប់បរិបទ AI ប៉ុណ្ណោះ មិនមែនសម្រាប់អនុញ្ញាតបង្ហោះទេ។'
                  : 'If you connected TikTok in TikTok Activity, you do not need to enter it again here. This optional handle only gives the AI business context; it does not authorize publishing.'}
              </p>
              <input
                type="text"
                value={tiktokHandle}
                onChange={(e) => setTiktokHandle(e.target.value)}
                aria-label={language === 'km' ? 'ឈ្មោះ TikTok សម្រាប់បរិបទ AI (ជាជម្រើស)' : 'TikTok handle for AI context (optional)'}
                placeholder={language === 'km' ? 'ឈ្មោះ TikTok (ជាជម្រើស)' : 'TikTok handle (optional), e.g. @mycompany'}
                className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Send size={12} />
                {t('myTelegramChannelTitle')}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('myTelegramChannelDesc')}</p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="telegram-bot-token" className="mb-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('telegramBotTokenLabel')}</label>
                  <input
                    id="telegram-bot-token"
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder={t('telegramBotTokenPlaceholder')}
                    autoComplete="off"
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                </div>
                <div>
                  {/* This is the field the Sidebar's "Open Telegram Channel"
                      link and publishing destination actually read -- placed
                      and labeled ahead of the legacy Chat ID field below so
                      it isn't mistaken for it (see telegramChatId's own label:
                      the two were previously indistinguishable once typed,
                      since only placeholder text -- which disappears on input
                      -- told them apart). */}
                  <label htmlFor="telegram-channel-username" className="mb-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('telegramChannelUsernameLabel')}</label>
                  <input
                    id="telegram-channel-username"
                    type="text"
                    value={telegramChannelUrl}
                    onChange={(e) => setTelegramChannelUrl(e.target.value)}
                    placeholder={t('telegramChannelUsernamePlaceholder')}
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="telegram-chat-id" className="mb-1 block text-[10px] font-bold text-slate-500 dark:text-slate-400">{t('telegramChatIdLabel')}</label>
                  <input
                    id="telegram-chat-id"
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder={t('telegramChatIdPlaceholder')}
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                </div>
              </div>
            </div>

            {!isDemoMode && user && (
              <div>
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Bot size={12} />
                  {t('myTelegramBotTitle')}
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('myTelegramBotDesc')}</p>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold',
                    telegramBotActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    <span className={cn('w-2 h-2 rounded-full', telegramBotActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
                    {telegramBotActive ? t('botActiveStatus') : t('botInactiveStatus')}
                  </span>
                  <button
                    onClick={handleToggleBotActive}
                    disabled={activatingBot || !savedTelegramBotToken || telegramBotToken.trim() !== savedTelegramBotToken}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                      telegramBotActive
                        ? 'bg-rose-50 hover:bg-rose-100 text-rose-600'
                        : 'bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-brand-600 dark:text-brand-400'
                    )}
                  >
                    {activatingBot ? <Loader2 size={16} className="animate-spin" /> : null}
                    {telegramBotActive ? t('deactivateMyBot') : t('activateMyBot')}
                  </button>
                </div>
                {(!savedTelegramBotToken || telegramBotToken.trim() !== savedTelegramBotToken) && (
                  <p className="text-[11px] text-amber-600 mt-2">{t('saveBotTokenFirst')}</p>
                )}
                {botStatusMessage && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{botStatusMessage}</p>}
              </div>
            )}

            {error && <p className="text-sm text-rose-500">{error}</p>}

            <div className="flex items-center justify-end gap-3 pt-2">
              <AnimatePresence>
                {saved && (
                  <motion.span
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium"
                  >
                    <CheckCircle2 size={16} />
                    {t('savedSuccessfully')}
                  </motion.span>
                )}
              </AnimatePresence>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-brand-700 hover:bg-brand-800 text-white rounded-2xl font-bold text-sm shadow-lg shadow-brand-700/20 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {t('saveProfile')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default BusinessProfile;
