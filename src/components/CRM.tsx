import React, { useEffect, useState } from 'react';
import { Users, MessageCircle, Send, Loader2, Search, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';

interface TelegramLead {
  id: string;
  chatId: string;
  username: string | null;
  displayName: string;
  tag: string;
  messageCount: number;
  lastMessage: string;
  lastMessageAt?: { toDate: () => Date };
  createdAt?: { toDate: () => Date };
}

const TAG_STYLES: Record<string, string> = {
  interested: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  'price-question': 'bg-amber-50 text-amber-600 border-amber-200',
  support: 'bg-sky-50 text-sky-600 border-sky-200',
  general: 'bg-brand-50 text-brand-600 border-brand-200',
};

const CRM: React.FC = () => {
  const { t } = useLanguage();
  const [leads, setLeads] = useState<TelegramLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'telegram_leads'), orderBy('lastMessageAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setLeads(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as TelegramLead[]);
        setLoading(false);
      },
      (error) => {
        console.error('CRM leads listener error:', error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const filteredLeads = leads.filter((lead) => {
    if (tagFilter && lead.tag !== tagFilter) return false;
    if (!searchInput.trim()) return true;
    const needle = searchInput.trim().toLowerCase();
    return lead.displayName?.toLowerCase().includes(needle) || lead.username?.toLowerCase().includes(needle) || lead.lastMessage?.toLowerCase().includes(needle);
  });

  const tagCounts = leads.reduce<Record<string, number>>((acc, lead) => {
    acc[lead.tag] = (acc[lead.tag] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <header>
        <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
          {t('crmTitle')}
          <Users className="text-brand-500" size={32} />
        </h2>
        <p className="text-slate-500 mt-1 text-lg">{t('crmSubtitle')}</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button
          onClick={() => setTagFilter(null)}
          className={cn(
            'glass p-5 rounded-2xl border text-left transition-all',
            tagFilter === null ? 'border-brand-500 shadow-sm' : 'border-brand-100'
          )}
        >
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('allLeads')}</p>
          <p className="text-2xl font-bold text-brand-700">{leads.length}</p>
        </button>
        {['interested', 'price-question', 'support', 'general'].map((tag) => (
          <button
            key={tag}
            onClick={() => setTagFilter(tag)}
            className={cn(
              'glass p-5 rounded-2xl border text-left transition-all',
              tagFilter === tag ? 'border-brand-500 shadow-sm' : 'border-brand-100'
            )}
          >
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t(`leadTag_${tag.replace('-', '_')}` as any)}</p>
            <p className="text-2xl font-bold text-brand-700">{tagCounts[tag] || 0}</p>
          </button>
        ))}
      </div>

      <div className="relative">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('searchLeadsPlaceholder')}
          className="w-full pl-12 pr-5 py-4 bg-brand-50 border border-brand-100 rounded-2xl focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all font-medium"
        />
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={20} />
      </div>

      <div className="glass rounded-[2rem] overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-16">
            <Loader2 className="animate-spin text-brand-400" size={28} />
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="text-center py-20 px-10">
            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-100">
              <MessageCircle size={24} className="text-brand-300" />
            </div>
            <h3 className="text-brand-700 font-bold mb-1">{t('noLeadsYet')}</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">{t('noLeadsYetDesc')}</p>
          </div>
        ) : (
          <div className="divide-y divide-brand-100">
            <AnimatePresence mode="popLayout">
              {filteredLeads.map((lead) => (
                <motion.div
                  key={lead.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-4 p-6 hover:bg-brand-50 transition-colors"
                >
                  <div className="w-12 h-12 bg-sky-50 text-sky-600 rounded-xl flex items-center justify-center border border-sky-100 shrink-0">
                    <Send size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-brand-700">{lead.displayName}</span>
                      {lead.username && <span className="text-xs text-slate-400">@{lead.username}</span>}
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border flex items-center gap-1', TAG_STYLES[lead.tag] || TAG_STYLES.general)}>
                        <Tag size={10} />
                        {t(`leadTag_${lead.tag.replace('-', '_')}` as any)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2">{lead.lastMessage}</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">
                      {t('messagesCount').replace('{count}', String(lead.messageCount || 1))}
                      {lead.lastMessageAt?.toDate ? ` • ${lead.lastMessageAt.toDate().toLocaleString()}` : ''}
                    </p>
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

export default CRM;
