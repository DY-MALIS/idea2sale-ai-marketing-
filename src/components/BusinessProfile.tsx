import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Building2, User, Plus, Trash2, Save, CheckCircle2, Loader2, Send } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { BusinessDirectoryEntry, BusinessProfileData } from '../types';
import { recordAuditEvent } from '../lib/auditClient';

const DEMO_STORAGE_KEY = 'demo_business_profile';
const LOGO_MAX_DIMENSION = 256;

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

interface BusinessProfileProps {
  onClose: () => void;
}

const BusinessProfile: React.FC<BusinessProfileProps> = ({ onClose }) => {
  const { t } = useLanguage();
  const { user, isDemoMode, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [directory, setDirectory] = useState<BusinessDirectoryEntry[]>([]);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

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
      try {
        if (isDemoMode || !user) {
          const local = getLocalProfile();
          if (cancelled) return;
          setBusinessName(local.businessName);
          setLogoDataUrl(local.logoDataUrl);
          setDirectory(local.directory || []);
          setTelegramBotToken(local.telegramBotToken || '');
          setTelegramChatId(local.telegramChatId || '');
        } else {
          const snap = await getDoc(doc(db, 'business_profiles', user.uid));
          if (cancelled) return;
          if (snap.exists()) {
            const data = snap.data() as BusinessProfileData;
            setBusinessName(data.businessName || '');
            setLogoDataUrl(data.logoDataUrl || '');
            setDirectory(data.directory || []);
            setTelegramBotToken(data.telegramBotToken || '');
            setTelegramChatId(data.telegramChatId || '');
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
    setSaving(true);
    setError(null);
    setSaved(false);
    const profile: BusinessProfileData = {
      businessName: businessName.trim(),
      logoDataUrl,
      directory,
      telegramBotToken: telegramBotToken.trim(),
      telegramChatId: telegramChatId.trim(),
    };
    try {
      if (isDemoMode || !user) {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(profile));
      } else {
        await setDoc(doc(db, 'business_profiles', user.uid), {
          ...profile,
          userId: user.uid,
          updatedAt: serverTimestamp()
        });
        void recordAuditEvent('business_profile_updated', {
          businessName: profile.businessName,
          directoryEntries: profile.directory.length,
          hasLogo: Boolean(profile.logoDataUrl),
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      console.error('Failed to save business profile:', err);
      setError(err.message || t('businessProfileSaveError'));
    } finally {
      setSaving(false);
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

            <div>
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Send size={12} />
                {t('myTelegramChannelTitle')}
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('myTelegramChannelDesc')}</p>
              <div className="space-y-2">
                <input
                  type="password"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder={t('telegramBotTokenPlaceholder')}
                  autoComplete="off"
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                />
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder={t('telegramChatIdPlaceholder')}
                  className="w-full px-4 py-3 bg-brand-50 border border-brand-100 dark:bg-slate-800 dark:border-slate-700 rounded-2xl text-sm text-brand-700 dark:text-slate-100 focus:outline-none focus:ring-2 ring-brand-500/20"
                />
              </div>
            </div>

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
