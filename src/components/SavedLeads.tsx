import React, { useEffect, useState } from 'react';
import { Bookmark, Trash2, Mail, Phone, Globe, ExternalLink, CheckCircle2, Circle, Building2, Users, ArrowRightLeft, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, deleteDoc, updateDoc, serverTimestamp, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

interface SavedLead {
  id: string;
  recordType?: 'customer' | 'competitor';
  businessName: string;
  businessType: string;
  address?: string;
  phone?: string;
  email?: string;
  telegram?: string;
  website?: string;
  facebookPageName?: string;
  facebookPageUrl?: string;
  linkedinUrl?: string;
  leadLevel?: string;
  opportunityType?: 'customer' | 'ai_interest' | 'high_value' | 'construction' | 'competitor_activity' | 'competitor_customers' | 'hiring';
  jobTypes?: string[];
  recommendedService?: string;
  inboxMessage?: string;
  evidenceSourceUrl?: string;
  matchReason?: string;
  topAngle?: string;
  offerStrategy?: string;
  weakness?: string;
  counterStrategy?: string;
  publicActivitySignals?: string[];
  customerSegments?: string[];
  contacted?: boolean;
  createdAt?: { toDate: () => Date };
}

const LEVEL_STYLES: Record<string, string> = {
  Hot: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/60',
  Warm: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/60',
  Cold: 'bg-brand-50 text-brand-600 border-brand-200 dark:bg-slate-800 dark:text-brand-400 dark:border-slate-700',
};

const isCompetitorRecord = (lead: SavedLead) => lead.recordType === 'competitor'
  || ['competitor_activity', 'competitor_customers'].includes(lead.opportunityType || '');

// Standalone from CRM & Leads (which is Telegram-conversation-based) --
// this is a business the owner chose to keep past one Facebook Scanner
// session (see "Save to CRM" in FacebookScanner.tsx), a different kind of
// record entirely (no chat/message history, just researched contact info).
const SavedLeads: React.FC = () => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<'customer' | 'competitor'>('customer');
  const [movingRecordId, setMovingRecordId] = useState<string | null>(null);

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

  const toggleContacted = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'saved_leads', id), {
        contacted: !current,
        contactedAt: !current ? serverTimestamp() : null,
      });
    } catch (error) {
      console.error('Failed to update contacted status:', error);
    }
  };

  const moveSavedLead = async (lead: SavedLead, target: 'customer' | 'competitor') => {
    if (movingRecordId) return;
    setMovingRecordId(lead.id);
    try {
      await updateDoc(doc(db, 'saved_leads', lead.id), {
        recordType: target,
        opportunityType: target === 'competitor' ? 'competitor_activity' : 'customer',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to move saved lead:', error);
    } finally {
      setMovingRecordId(null);
    }
  };

  // Scanner mode is authoritative for records created by the briefly deployed
  // version that incorrectly stamped every potential lead as `customer`, as well
  // as for older records with no recordType at all.
  const customers = savedLeads.filter((lead) => !isCompetitorRecord(lead));
  const competitors = savedLeads.filter(isCompetitorRecord);
  const visibleRecords = activeCategory === 'customer' ? customers : competitors;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <header>
        <h2 className="text-4xl font-display font-bold text-brand-700 dark:text-brand-400 tracking-tight flex items-center gap-3">
          {t('savedLeadsTitle')}
          <Bookmark className="text-brand-500" size={32} />
        </h2>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-lg">{t('savedLeadsSubtitle')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2" role="tablist" aria-label={t('savedLeadsTitle')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'customer'}
          onClick={() => setActiveCategory('customer')}
          className={cn(
            'flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all',
            activeCategory === 'customer'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-brand-100 bg-white/60 text-slate-500 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
          )}
        >
          <span className="flex items-center gap-3 font-bold"><Users size={20} />{t('savedCustomersTab')}</span>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black dark:bg-slate-900/70">{customers.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === 'competitor'}
          onClick={() => setActiveCategory('competitor')}
          className={cn(
            'flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all',
            activeCategory === 'competitor'
              ? 'border-indigo-300 bg-indigo-50 text-indigo-800 shadow-sm dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200'
              : 'border-brand-100 bg-white/60 text-slate-500 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
          )}
        >
          <span className="flex items-center gap-3 font-bold"><Building2 size={20} />{t('savedCompetitorsTab')}</span>
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-black dark:bg-slate-900/70">{competitors.length}</span>
        </button>
      </div>

      <div className="glass rounded-[2rem] overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-300 border-t-transparent" />
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="text-center py-20 px-10">
            <div className="w-16 h-16 bg-brand-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-100 dark:border-slate-700">
              {activeCategory === 'customer'
                ? <Users size={24} className="text-emerald-400" />
                : <Building2 size={24} className="text-indigo-400" />}
            </div>
            <h3 className="text-brand-700 dark:text-brand-400 font-bold mb-1">
              {activeCategory === 'customer' ? t('noSavedLeadsYet') : t('noSavedCompetitorsYet')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {activeCategory === 'customer' ? t('noSavedLeadsYetDesc') : t('noSavedCompetitorsYetDesc')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-brand-100">
            <AnimatePresence mode="popLayout">
              {visibleRecords.map((lead) => (
                <motion.div
                  key={lead.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-4 p-6 hover:bg-brand-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className={cn(
                    'w-12 h-12 rounded-xl flex items-center justify-center border shrink-0',
                    isCompetitorRecord(lead)
                      ? 'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900'
                      : lead.contacted
                        ? 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                        : 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/60'
                  )}>
                    {isCompetitorRecord(lead) ? <Building2 size={20} /> : <Bookmark size={20} />}
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
                    {isCompetitorRecord(lead) ? (
                      <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                        {lead.matchReason && <p className="sm:col-span-2"><span className="font-bold text-indigo-500">{language === 'km' ? 'ហេតុអ្វីជាគូប្រកួត:' : 'Why this is a competitor:'}</span> {lead.matchReason}</p>}
                        {lead.topAngle && <p><span className="font-bold text-slate-400">Angle:</span> {lead.topAngle}</p>}
                        {lead.offerStrategy && <p><span className="font-bold text-slate-400">Offer:</span> {lead.offerStrategy}</p>}
                        {lead.weakness && <p><span className="font-bold text-rose-500">Weakness:</span> {lead.weakness}</p>}
                        {(lead.counterStrategy || lead.recommendedService) && <p><span className="font-bold text-emerald-600">Opportunity:</span> {lead.counterStrategy || lead.recommendedService}</p>}
                      </div>
                    ) : <>
                      {!!lead.jobTypes?.length && <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{language === 'km' ? 'ប្រភេទការងារ៖' : 'Job types:'} {lead.jobTypes.join(' • ')}</p>}
                      {lead.recommendedService && <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{lead.recommendedService}</p>}
                    </>}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {lead.phone && <span className="flex items-center gap-1"><Phone size={12} />{lead.phone}</span>}
                      {lead.email && <span className="flex items-center gap-1"><Mail size={12} />{lead.email}</span>}
                      {lead.website && <span className="flex items-center gap-1"><Globe size={12} />{lead.website}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {lead.facebookPageUrl && (
                        <a href={lead.facebookPageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"><ExternalLink size={12} />Facebook</a>
                      )}
                      {lead.linkedinUrl && (
                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:underline dark:text-sky-300"><ExternalLink size={12} />LinkedIn</a>
                      )}
                      {lead.evidenceSourceUrl && (
                        <a href={lead.evidenceSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline"><ExternalLink size={12} />{t('viewLeadSource')}</a>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void moveSavedLead(lead, isCompetitorRecord(lead) ? 'customer' : 'competitor')}
                      disabled={movingRecordId === lead.id}
                      title={isCompetitorRecord(lead)
                        ? (language === 'km' ? 'ផ្លាស់ទៅអតិថិជន' : 'Move to customers')
                        : (language === 'km' ? 'ផ្លាស់ទៅគូប្រកួត' : 'Move to competitors')}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-2 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-950/40 dark:text-indigo-300"
                    >
                      {movingRecordId === lead.id ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                      <span className="hidden xl:inline">
                        {isCompetitorRecord(lead)
                          ? (language === 'km' ? 'ទៅអតិថិជន' : 'To customers')
                          : (language === 'km' ? 'ទៅគូប្រកួត' : 'To competitors')}
                      </span>
                    </button>
                    {!isCompetitorRecord(lead) && (
                      <button
                        onClick={() => void toggleContacted(lead.id, Boolean(lead.contacted))}
                        title={lead.contacted ? t('markNotContacted') : t('markContacted')}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold transition-colors',
                          lead.contacted
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                        )}
                      >
                        {lead.contacted ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                        {lead.contacted ? t('contactedStatus') : t('notContactedStatus')}
                      </button>
                    )}
                    <button
                      onClick={() => void deleteSavedLead(lead.id)}
                      title={t('deleteSavedLead')}
                      className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
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
