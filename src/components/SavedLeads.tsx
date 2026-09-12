import React, { useEffect, useState } from 'react';
import { Bookmark, Trash2, Mail, Phone, Globe, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, deleteDoc, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

interface SavedLead {
  id: string;
  businessName: string;
  businessType: string;
  address?: string;
  phone?: string;
  email?: string;
  telegram?: string;
  website?: string;
  facebookPageName?: string;
  facebookPageUrl?: string;
  leadLevel?: string;
  recommendedService?: string;
  inboxMessage?: string;
  evidenceSourceUrl?: string;
  createdAt?: { toDate: () => Date };
}

const LEVEL_STYLES: Record<string, string> = {
  Hot: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/60',
  Warm: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/60',
  Cold: 'bg-brand-50 text-brand-600 border-brand-200 dark:bg-slate-800 dark:text-brand-400 dark:border-slate-700',
};

// Standalone from CRM & Leads (which is Telegram-conversation-based) --
// this is a business the owner chose to keep past one Facebook Scanner
// session (see "Save to CRM" in FacebookScanner.tsx), a different kind of
// record entirely (no chat/message history, just researched contact info).
const SavedLeads: React.FC = () => {
  const { t } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isDemoMode || !user) {
      setLoading(false);
      return;
    }
    const q = query(collection(db, 'saved_leads'), where('ownerId', '==', user.uid), limit(200));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as SavedLead))
        .sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0));
      setSavedLeads(rows);
      setLoading(false);
    }, (error) => {
      console.error('Saved leads listener error:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, isDemoMode]);

  const deleteSavedLead = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'saved_leads', id));
    } catch (error) {
      console.error('Failed to delete saved lead:', error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <header>
        <h2 className="text-4xl font-display font-bold text-brand-700 dark:text-brand-400 tracking-tight flex items-center gap-3">
          {t('savedLeadsTitle')}
          <Bookmark className="text-brand-500" size={32} />
        </h2>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-lg">{t('savedLeadsSubtitle')}</p>
      </header>

      <div className="glass rounded-[2rem] overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-300 border-t-transparent" />
          </div>
        ) : savedLeads.length === 0 ? (
          <div className="text-center py-20 px-10">
            <div className="w-16 h-16 bg-brand-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-100 dark:border-slate-700">
              <Bookmark size={24} className="text-brand-300" />
            </div>
            <h3 className="text-brand-700 dark:text-brand-400 font-bold mb-1">{t('noSavedLeadsYet')}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">{t('noSavedLeadsYetDesc')}</p>
          </div>
        ) : (
          <div className="divide-y divide-brand-100">
            <AnimatePresence mode="popLayout">
              {savedLeads.map((lead) => (
                <motion.div
                  key={lead.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-4 p-6 hover:bg-brand-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 rounded-xl flex items-center justify-center border border-emerald-100 dark:border-emerald-800/60 shrink-0">
                    <Bookmark size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-brand-700 dark:text-brand-400">{lead.businessName}</span>
                      {lead.businessType && <span className="text-xs text-slate-400 dark:text-slate-400">{lead.businessType}</span>}
                      {lead.leadLevel && (
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border', LEVEL_STYLES[lead.leadLevel] || LEVEL_STYLES.Cold)}>
                          {lead.leadLevel}
                        </span>
                      )}
                    </div>
                    {lead.recommendedService && <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{lead.recommendedService}</p>}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {lead.phone && <span className="flex items-center gap-1"><Phone size={12} />{lead.phone}</span>}
                      {lead.email && <span className="flex items-center gap-1"><Mail size={12} />{lead.email}</span>}
                      {lead.website && <span className="flex items-center gap-1"><Globe size={12} />{lead.website}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {lead.facebookPageUrl && (
                        <a href={lead.facebookPageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"><ExternalLink size={12} />Facebook</a>
                      )}
                      {lead.evidenceSourceUrl && (
                        <a href={lead.evidenceSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline"><ExternalLink size={12} />{t('viewLeadSource')}</a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void deleteSavedLead(lead.id)}
                    title={t('deleteSavedLead')}
                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default SavedLeads;
