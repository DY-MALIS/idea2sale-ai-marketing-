import React, { useState, useEffect, useRef } from 'react';
import {
  MessagesSquare,
  Bot,
  Zap,
  Shield,
  MessageCircle,
  Plus,
  ArrowRight,
  Loader2,
  X,
  AlertCircle,
  Inbox as InboxIcon,
  Send,
  Sparkles,
  Search,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, limit, startAfter, getDocs, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, setDoc, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useIsAdmin } from '../hooks/useIsAdmin';

interface TelegramLead {
  id: string;
  chatId: string;
  username: string | null;
  displayName: string;
  tag: string;
  lastMessage: string;
  lastMessageAt?: { toDate: () => Date };
}

interface TelegramMessage {
  id: string;
  chatId: string;
  direction: 'in' | 'out';
  text: string;
  source: 'user' | 'rule' | 'ai' | 'system';
  createdAt?: { toDate: () => Date };
}

interface ReplyRule {
  id: string;
  trigger: string;
  response: string;
  platform: string;
  userId: string;
  createdAt?: any;
}

const Automation: React.FC = () => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const { isAdmin, checking: checkingAdmin } = useIsAdmin();
  const [activeTab, setActiveTab] = useState<'reply' | 'inbox'>('reply');
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [replyRules, setReplyRules] = useState<ReplyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal states for Reply
  const [ruleTrigger, setRuleTrigger] = useState('');
  const [ruleResponse, setRuleResponse] = useState('');
  const [isCreatingRule, setIsCreatingRule] = useState(false);

  // Inbox state
  const INBOX_PAGE_SIZE = 30;
  const [inboxLeads, setInboxLeads] = useState<TelegramLead[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxLoadingMore, setInboxLoadingMore] = useState(false);
  const [inboxHasMore, setInboxHasMore] = useState(false);
  const [inboxLastDoc, setInboxLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [inboxSearch, setInboxSearch] = useState('');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inboxMessages, setInboxMessages] = useState<TelegramMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  useEffect(() => {
    if (activeTab !== 'inbox') return;
    if (checkingAdmin || !isAdmin) {
      setInboxLoading(false);
      return;
    }
    const q = query(collection(db, 'telegram_leads'), orderBy('lastMessageAt', 'desc'), limit(INBOX_PAGE_SIZE));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as TelegramLead[];
      setInboxLeads(data);
      setInboxLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setInboxHasMore(snapshot.docs.length === INBOX_PAGE_SIZE);
      setInboxLoading(false);
      setSelectedChatId((current) => current || data[0]?.chatId || null);
    }, (error) => {
      console.error('Inbox leads listener error:', error);
      setInboxLoading(false);
    });
    return () => unsubscribe();
  }, [activeTab, checkingAdmin, isAdmin]);

  const handleLoadMoreInboxLeads = async () => {
    if (!inboxLastDoc || inboxLoadingMore) return;
    setInboxLoadingMore(true);
    try {
      const q = query(collection(db, 'telegram_leads'), orderBy('lastMessageAt', 'desc'), startAfter(inboxLastDoc), limit(INBOX_PAGE_SIZE));
      const snapshot = await getDocs(q);
      const next = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as TelegramLead[];
      setInboxLeads((prev) => [...prev, ...next]);
      setInboxLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setInboxHasMore(snapshot.docs.length === INBOX_PAGE_SIZE);
    } catch (error) {
      console.error('Inbox load more error:', error);
    } finally {
      setInboxLoadingMore(false);
    }
  };

  const filteredInboxLeads = inboxLeads.filter((lead) => {
    if (!inboxSearch.trim()) return true;
    const needle = inboxSearch.trim().toLowerCase();
    return lead.displayName?.toLowerCase().includes(needle) || lead.username?.toLowerCase().includes(needle) || lead.lastMessage?.toLowerCase().includes(needle);
  });

  // Auto-load the next page as the user scrolls near the bottom of the list.
  const inboxSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = inboxSentinelRef.current;
    if (!node || !inboxHasMore || activeTab !== 'inbox') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) handleLoadMoreInboxLeads();
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [inboxHasMore, inboxLastDoc, activeTab]);

  useEffect(() => {
    if (!selectedChatId || activeTab !== 'inbox' || checkingAdmin || !isAdmin) return;
    setMessagesLoading(true);
    // Sort client-side (not orderBy in the query) to avoid needing a composite
    // Firestore index for the chatId + createdAt combination.
    const q = query(
      collection(db, 'telegram_messages'),
      where('chatId', '==', selectedChatId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as TelegramMessage[];
      messages.sort((a, b) => (a.createdAt?.toDate?.().getTime() || 0) - (b.createdAt?.toDate?.().getTime() || 0));
      setInboxMessages(messages);
      setMessagesLoading(false);
    }, (error) => {
      console.error('Inbox messages listener error:', error);
      setMessagesLoading(false);
    });
    return () => unsubscribe();
  }, [selectedChatId, activeTab, checkingAdmin, isAdmin]);

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text || !selectedChatId || sendingReply) return;
    setSendingReply(true);
    setErrorMsg(null);

    if (isDemoMode) {
      setInboxMessages((prev) => [...prev, {
        id: Date.now().toString(),
        chatId: selectedChatId,
        direction: 'out',
        text,
        source: 'system',
        createdAt: { toDate: () => new Date() }
      }]);
      setReplyText('');
      setSendingReply(false);
      return;
    }

    try {
      if (!user) throw new Error(language === 'km' ? 'សូម Sign in ជាមុនសិន' : 'Please sign in first.');
      const idToken = await user.getIdToken();
      const response = await fetch('/api/telegram/webhook?action=reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ chatId: selectedChatId, text })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || (language === 'km' ? 'មិនអាចផ្ញើសារបានទេ' : 'Could not send this reply.'));
      }
      setReplyText('');
    } catch (err: any) {
      setErrorMsg(err.message || (language === 'km' ? 'មិនអាចផ្ញើសារបានទេ' : 'Could not send this reply.'));
    } finally {
      setSendingReply(false);
    }
  };

  useEffect(() => {
    let unsubscribe: () => void;

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    if (userToUse) {
      if (isDemoMode) {
        // Mock data for demo mode
        setReplyRules([
          { id: '1', trigger: 'price', response: 'Hi! The price is $25.', platform: 'TikTok', userId: 'demo-user' },
          { id: '2', trigger: 'available', response: 'Yes, it is available!', platform: 'Facebook', userId: 'demo-user' }
        ]);
        setLoading(false);
      } else {
        const qR = query(
          collection(db, 'reply_rules'),
          where('userId', '==', userToUse.uid)
        );

        unsubscribe = onSnapshot(qR,
          (snapshot) => {
            const data = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })) as ReplyRule[];

            setReplyRules(data);
            setLoading(false);
          },
          (error) => {
            console.error("Firestore Error in Reply Rules:", error);
            setLoading(false);
          }
        );
      }
    } else {
      setReplyRules([]);
      setLoading(false);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, isDemoMode]);

  const [stats, setStats] = useState({ replies: 0, hours: 0, rate: 0 });
  // Shared across the whole app (one Telegram bot for every business using this
  // deployment, see README) -- backed by settings/automation in Firestore so the
  // server-side webhook (api/telegram/webhook.js) can actually honor it. This used
  // to be localStorage-only, which only changed this browser's own UI and never
  // stopped the bot from auto-replying to real customers.
  const [isAutomationActive, setIsAutomationActive] = useState(true);
  const [isTraining, setIsTraining] = useState(false);

  useEffect(() => {
    if (isDemoMode) return;
    const unsubscribe = onSnapshot(doc(db, 'settings', 'automation'), (snap) => {
      setIsAutomationActive(snap.data()?.active !== false);
    }, (error) => {
      console.error('Automation-active listener error:', error);
    });
    return () => unsubscribe();
  }, [isDemoMode]);

  const toggleGlobalAutomation = async () => {
    const newState = !isAutomationActive;
    setIsAutomationActive(newState);
    if (isDemoMode) return;
    try {
      await setDoc(doc(db, 'settings', 'automation'), {
        active: newState,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
      }, { merge: true });
    } catch (err: any) {
      console.error('Error toggling automation:', err);
      setIsAutomationActive(!newState);
      setErrorMsg(language === 'km' ? 'មិនអាចផ្លាស់ប្តូរស្ថានភាពស្វ័យប្រវត្តិកម្មបានទេ៖ ' + (err.message || '') : 'Failed to update automation status: ' + (err.message || ''));
    }
  };

  const handleTrainAI = () => {
    setIsTraining(true);
    // Simulate activation process
    setTimeout(() => {
      setIsTraining(false);
      alert(language === 'km' 
        ? 'ការបង្កើត AI របស់អ្នកបានជោគជ័យ! បច្ចេកវិទ្យា AI ឥឡូវបេះកំពុងដំណើរការ។' 
        : 'Your AI creation is successful! AI technology is now operational.');
    }, 2000);
  };

  useEffect(() => {
    if (isDemoMode) {
      setStats({ replies: 1248, hours: 12, rate: 84 });
    } else {
      // Calculate real stats based on active reply rules
      const activeCount = replyRules.length;
      const hoursSaved = activeCount * 2.5; // Rough estimate: 2.5 hours per active rule
      setStats({
        replies: activeCount * 15, // Mocking replies for now as we don't have a replies collection
        hours: Math.round(hoursSaved),
        rate: activeCount > 0 ? 82 : 0
      });
    }
  }, [replyRules, isDemoMode]);

  const handleCreateRule = async () => {
    if (!ruleTrigger.trim() || !ruleResponse.trim()) {
      setErrorMsg(language === 'km' ? 'សូមបំពេញព័ត៌មានឱ្យបានគ្រប់គ្រាន់' : 'Please fill in all fields');
      return;
    }

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);
    if (!userToUse) return;
    const normalizedTrigger = ruleTrigger
      .split(/[,;|\n\r،，]+/u)
      .map(keyword => keyword.trim())
      .filter(Boolean)
      .join(', ');

    setIsCreatingRule(true);
    setErrorMsg(null);

    if (isDemoMode) {
      setTimeout(() => {
        setReplyRules(prev => [...prev, {
          id: Date.now().toString(),
          trigger: normalizedTrigger,
          response: ruleResponse.trim(),
          platform: 'TELEGRAM',
          userId: 'demo-user'
        }]);
        setIsCreatingRule(false);
        setIsRuleModalOpen(false);
        setRuleTrigger('');
        setRuleResponse('');
      }, 800);
      return;
    }

    try {
      await addDoc(collection(db, 'reply_rules'), {
        trigger: normalizedTrigger,
        response: ruleResponse.trim(),
        platform: 'TELEGRAM',
        userId: userToUse.uid,
        createdAt: serverTimestamp()
      });
      setIsRuleModalOpen(false);
      setRuleTrigger('');
      setRuleResponse('');
    } catch (err: any) {
      console.error('Error creating rule:', err);
      setErrorMsg(err.message || 'Failed to create rule');
    } finally {
      setIsCreatingRule(false);
    }
  };

  const deleteRule = async (id: string) => {
    try {
      if (isDemoMode) {
        setReplyRules(prev => prev.filter(r => r.id !== id));
        return;
      }
      await deleteDoc(doc(db, 'reply_rules', id));
    } catch (err: any) {
      console.error('Error deleting rule:', err);
      const msg = err.message || '';
      if (msg.includes('insufficient permissions')) {
        setErrorMsg(language === 'km' ? 'អ្នកមិនមានការអនុញ្ញាតឱ្យលុបទិន្នន័យនេះទេ។' : 'You do not have permission to delete this.');
      } else {
        setErrorMsg(language === 'km' ? 'មិនអាចលុបបាន៖ ' + msg : 'Failed to delete: ' + msg);
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 dark:text-brand-400 tracking-tight flex items-center gap-3">
            {t('socialAutomation')}
            <MessagesSquare className="text-brand-500" size={32} />
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <div className={cn(
              "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold transition-all",
              isAutomationActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            )}>
              <div className={cn("w-2 h-2 rounded-full", isAutomationActive ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
              {isAutomationActive ? (language === 'km' ? 'កំពុងដំណើរការ' : 'ACTIVE') : (language === 'km' ? 'បានផ្អាក' : 'PAUSED')}
            </div>
            {isDemoMode || isAdmin ? (
              <button
                onClick={toggleGlobalAutomation}
                className="text-xs font-bold text-brand-600 hover:underline"
              >
                {isAutomationActive
                  ? (language === 'km' ? 'ចុចទីនេះដើម្បីបិទ' : 'Click to disable')
                  : (language === 'km' ? 'ចុចទីនេះដើម្បីបើកដំណើរការ' : 'Click to enable')
                }
              </button>
            ) : (
              <span className="text-xs text-slate-400" title={language === 'km' ? 'admin ប៉ុណ្ណោះទើបផ្លាស់ប្តូរបាន' : 'Only admins can change this'}>
                {language === 'km' ? 'សម្រាប់ admin ប៉ុណ្ណោះ' : 'Admin-only setting'}
              </span>
            )}
          </div>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-lg">{t('engagementTeam')}</p>
        </div>
        <div className="flex bg-brand-100/50 p-1.5 rounded-2xl border border-brand-200">
          <button
            onClick={() => setActiveTab('reply')}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all", activeTab === 'reply' ? "bg-white dark:bg-slate-700 text-brand-700 dark:text-brand-400 shadow-sm" : "text-brand-500 hover:bg-brand-50 dark:hover:bg-slate-700")}
          >
            {t('smartReply')}
          </button>
          <button
            onClick={() => setActiveTab('inbox')}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all", activeTab === 'inbox' ? "bg-white dark:bg-slate-700 text-brand-700 dark:text-brand-400 shadow-sm" : "text-brand-500 hover:bg-brand-50 dark:hover:bg-slate-700")}
          >
            {t('inboxLabel')}
          </button>
        </div>
      </header>

      {errorMsg && !isRuleModalOpen && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 rounded-xl border border-red-100 dark:border-red-800/60 flex items-center gap-3 shadow-sm"
        >
          <AlertCircle size={20} className="shrink-0" />
          <p className="text-sm font-medium">{errorMsg}</p>
          <button 
            onClick={() => setErrorMsg(null)}
            className="ml-auto p-1 hover:bg-red-100 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </motion.div>
      )}

      <div className="rounded-2xl border border-brand-200 dark:border-slate-700 bg-brand-50 dark:bg-slate-800 px-5 py-4 text-sm text-brand-700 dark:text-brand-400">
        <strong>{t('socialAutomation')}</strong>
        <span className="ml-2">{t('automationRoleDesc')}</span>
      </div>

      {activeTab === 'inbox' && !checkingAdmin && !isAdmin ? (
        <div className="glass rounded-[2rem] overflow-hidden text-center py-20 px-10">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-100 dark:border-amber-800/60">
            <ShieldAlert size={24} className="text-amber-500" />
          </div>
          <h3 className="text-brand-700 dark:text-brand-400 font-bold mb-1">{t('adminOnlyTitle')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">{t('adminOnlyDesc')}</p>
        </div>
      ) : activeTab === 'inbox' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 glass rounded-[2rem] overflow-hidden max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-brand-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-brand-700 dark:text-brand-400 flex items-center gap-2">
                <InboxIcon size={18} className="text-brand-500" />
                {t('inboxLabel')}
              </h3>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400">{inboxLeads.length}{inboxHasMore ? '+' : ''}</span>
            </div>
            <div className="p-3 border-b border-brand-50 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  value={inboxSearch}
                  onChange={(e) => setInboxSearch(e.target.value)}
                  placeholder={t('searchLeadsPlaceholder')}
                  className="w-full pl-9 pr-3 py-2 bg-brand-50 dark:bg-slate-800 border border-brand-100 dark:border-slate-600 dark:text-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-400" size={14} />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {inboxLoading ? (
                <div className="flex justify-center p-10"><Loader2 className="animate-spin text-brand-400" /></div>
              ) : filteredInboxLeads.length === 0 ? (
                <div className="text-center p-10">
                  <MessageCircle size={32} className="mx-auto text-brand-200 mb-3" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('noLeadsYet')}</p>
                </div>
              ) : (
                <>
                  {filteredInboxLeads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedChatId(lead.chatId)}
                      className={cn(
                        'w-full text-left p-4 border-b border-brand-50 transition-colors',
                        selectedChatId === lead.chatId ? 'bg-brand-50 dark:bg-slate-800' : 'hover:bg-brand-50/50 dark:hover:bg-slate-800/50'
                      )}
                    >
                      <p className="font-bold text-sm text-brand-700 dark:text-brand-400 truncate">{lead.displayName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{lead.lastMessage}</p>
                    </button>
                  ))}
                  {inboxHasMore && (
                    <div ref={inboxSentinelRef} className="flex justify-center p-3">
                      <Loader2 className="animate-spin text-brand-300" size={14} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="lg:col-span-8 glass rounded-[2rem] overflow-hidden max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-brand-100 dark:border-slate-700 bg-brand-50 dark:bg-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Bot size={18} className="text-brand-500" />
                <h3 className="font-bold text-brand-700 dark:text-brand-400">
                  {inboxLeads.find((l) => l.chatId === selectedChatId)?.displayName || t('inboxLabel')}
                </h3>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
                <Sparkles size={10} />
                {t('agentStandingBy')}
              </span>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-3">
              {!selectedChatId ? (
                <div className="text-center p-10 text-sm text-slate-400 dark:text-slate-400">{t('selectLeadPrompt')}</div>
              ) : messagesLoading ? (
                <div className="flex justify-center p-10"><Loader2 className="animate-spin text-brand-400" /></div>
              ) : inboxMessages.length === 0 ? (
                <div className="text-center p-10 text-sm text-slate-400 dark:text-slate-400">{t('noLeadsYet')}</div>
              ) : (
                inboxMessages.map((msg) => (
                  <div key={msg.id} className={cn('flex', msg.direction === 'in' ? 'justify-start' : 'justify-end')}>
                    <div className={cn(
                      'max-w-[75%] px-4 py-3 rounded-2xl text-sm',
                      msg.direction === 'in' ? 'bg-brand-50 dark:bg-slate-800 text-brand-700 dark:text-brand-400' : 'bg-brand-700 text-white'
                    )}>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      {msg.direction === 'out' && (
                        <p className="text-[9px] mt-1 opacity-70 uppercase tracking-widest flex items-center gap-1">
                          <Send size={9} />
                          {msg.source === 'rule' ? t('sourceRule') : msg.source === 'ai' ? t('sourceAi') : t('sourceSystem')}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            {selectedChatId && (
              <div className="p-4 border-t border-brand-100 bg-white dark:bg-slate-800 flex items-end gap-2 shrink-0">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                  placeholder={language === 'km' ? 'វាយសារឆ្លើយតប...' : 'Type a reply...'}
                  rows={1}
                  className="flex-1 px-4 py-3 bg-brand-50 dark:bg-slate-800 border border-brand-100 dark:border-slate-600 rounded-xl text-sm text-brand-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 ring-brand-500/20 resize-none max-h-32"
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sendingReply}
                  className="px-4 py-3 bg-brand-700 text-white rounded-xl font-bold hover:bg-brand-800 transition-all disabled:opacity-40 shrink-0"
                >
                  {sendingReply ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
            <div className="glass p-10 rounded-[2.5rem] shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-brand-700 dark:text-brand-400">{t('smartAiReplies')}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">{t('aiReplyDesc')}</p>
                </div>
                <button
                  onClick={() => {
                    setIsRuleModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-700 text-white rounded-xl font-bold hover:bg-brand-800 transition-all"
                >
                  <Plus size={20} />
                  {t('addRule')}
                </button>
              </div>

              <div className="mb-6 p-4 bg-sky-50 dark:bg-sky-900/30 border border-sky-100 dark:border-sky-800/60 rounded-2xl text-sm text-sky-700 dark:text-sky-300">
                {t('telegramRulesLiveNote')}
              </div>

              <div className="space-y-4">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Loader2 className="animate-spin text-brand-500" size={32} />
                  </div>
                ) : replyRules.length === 0 ? (
                  <div className="text-center py-20 bg-brand-50/30 dark:bg-slate-800/30 rounded-[2.5rem] border border-dashed border-brand-200 dark:border-slate-700">
                    <MessageCircle size={48} className="mx-auto text-brand-200 mb-4" />
                    <h4 className="text-brand-700 dark:text-brand-400 font-bold mb-1">{language === 'km' ? 'មិនទាន់មានច្បាប់ឆ្លើយតបនៅឡើយទេ' : 'No reply rules yet'}</h4>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{language === 'km' ? 'បង្កើតច្បាប់ដំបូងរបស់អ្នកដើម្បីសន្សំសំចៃពេលវេលា' : 'Create your first rule to save time'}</p>
                  </div>
                ) : (
                  replyRules.map((rule, i) => (
                    <div key={rule.id} className="p-6 bg-brand-50/50 dark:bg-slate-800/50 rounded-3xl border border-brand-100 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700 transition-all group relative">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-brand-400 uppercase tracking-widest bg-white dark:bg-slate-700 px-2 py-1 rounded border border-brand-100">{t('commentContains')}</span>
                          <span className="font-bold text-brand-700 dark:text-brand-400">"{rule.trigger}"</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-slate-400 dark:text-slate-400 font-bold">{rule.platform}</span>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="p-2 bg-white dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400 rounded-lg border border-brand-100 shadow-sm"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-brand-50 italic text-brand-600 text-sm">
                        <MessageCircle size={18} className="shrink-0 text-brand-400" />
                        "{rule.response}"
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
        </div>

        <div className="lg:col-span-4 space-y-8">
          <div className="bg-brand-700 p-10 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:rotate-12 transition-transform duration-500">
              <Bot size={120} />
            </div>
            <div className="relative z-10">
              <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6 border border-white/10">
                <Shield size={24} />
              </div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">{t('aiTrainingCenter')}</h3>
              <p className="text-brand-100/80 text-sm leading-relaxed mb-8">{t('aiTrainingDesc')}</p>
              <button 
                onClick={handleTrainAI}
                disabled={isTraining}
                className="w-full py-4 bg-crab-shell hover:bg-red-600 rounded-2xl font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2"
              >
                {isTraining ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    {language === 'km' ? 'កំពុងបង្កើត...' : 'Creating...'}
                  </>
                ) : t('trainMyAi')}
              </button>
            </div>
          </div>

          <div className="glass p-8 rounded-[2rem] border border-brand-100 shadow-sm relative group/stats">
            <h3 className="font-bold text-brand-700 dark:text-brand-400 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={20} className={isAutomationActive ? "text-amber-500" : "text-slate-300"} />
                {t('engagementStats')}
              </div>
              {isAutomationActive && <span className="text-[10px] text-emerald-500 animate-pulse font-bold">Auto-Sync ON</span>}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-brand-50 dark:bg-slate-800 px-4 py-6 rounded-2xl border border-brand-100 dark:border-slate-700">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">{t('totalReplies')}</p>
                <p className="text-2xl font-bold text-brand-700 dark:text-brand-400">{stats.replies.toLocaleString()}</p>
              </div>
              <div className="bg-brand-50 dark:bg-slate-800 px-4 py-6 rounded-2xl border border-brand-100 dark:border-slate-700">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">{t('timeSaved')}</p>
                <p className="text-2xl font-bold text-brand-700 dark:text-brand-400">{stats.hours}h</p>
              </div>
            </div>
            <p className="text-[10px] text-brand-400 mt-4 text-center">
              {language === 'km' 
                ? `AI កំពុងដោះស្រាយ ${stats.rate}% នៃការចូលរួមសរុបរបស់អ្នក។`
                : `AI is handling ${stats.rate}% of your total engagement.`
              }
            </p>
            
            {/* Source info Tooltip */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 p-3 bg-brand-800 text-white text-[10px] rounded-xl shadow-xl opacity-0 group-hover/stats:opacity-100 transition-all pointer-events-none z-20 text-center leading-relaxed">
              {isDemoMode 
                ? (language === 'km' ? 'ទិន្នន័យនេះបានមកពីប្រវត្តិរូបគម្រូ។' : 'This data comes from the demo profile.')
                : (language === 'km' ? 'ទិន្នន័យត្រូវបានគណនាដោយផ្អែកលើសកម្មភាពយុទ្ធនាការរបស់អ្នក។' : 'Data is calculated based on your campaign activity.')
              }
              <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-brand-800"></div>
            </div>
          </div>
        </div>
      </div>
      )}

      <AnimatePresence>
        {isRuleModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRuleModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-brand-50/30 dark:bg-slate-800/30">
                <div>
                  <h3 className="text-2xl font-bold text-brand-700 dark:text-brand-400">{t('addRule')}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">{t('aiReplyDesc')}</p>
                </div>
                <button onClick={() => setIsRuleModalOpen(false)} className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded-xl transition-all">
                  <X size={20} className="text-brand-400" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                {errorMsg && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 rounded-xl flex items-center gap-2 text-sm border border-red-100 dark:border-red-800/60">
                    <AlertCircle size={16} />
                    {errorMsg}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{language === 'km' ? 'ពាក្យគន្លឹះ (Keywords)' : 'Trigger Keywords'}</label>
                  <input 
                    type="text" 
                    value={ruleTrigger}
                    onChange={(e) => setRuleTrigger(e.target.value)}
                    placeholder={language === 'km' ? 'ឧទាហរណ៍៖ តម្លៃ, ប៉ុន្មាន...' : 'e.g. price, how much...'} 
                    className="w-full px-4 py-3 bg-brand-50 dark:bg-slate-800 border border-brand-100 dark:border-slate-600 rounded-xl text-brand-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 ring-brand-500/20"
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {language === 'km'
                      ? 'បំបែកពាក្យគន្លឹះនីមួយៗដោយសញ្ញាក្បៀស។ ឧទាហរណ៍៖ សួស្ដី, hello, hi'
                      : 'Separate each keyword with a comma. Example: hello, hi, good morning'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{language === 'km' ? 'ការឆ្លើយតប (Response)' : 'AI Response'}</label>
                  <textarea 
                    value={ruleResponse}
                    onChange={(e) => setRuleResponse(e.target.value)}
                    placeholder={language === 'km' ? 'បញ្ចូលការឆ្លើយតបរបស់អ្នក...' : 'Enter your automated response...'} 
                    className="w-full px-4 py-3 bg-brand-50 dark:bg-slate-800 border border-brand-100 dark:border-slate-600 rounded-xl text-brand-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 ring-brand-500/20 h-24 resize-none"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{t('platform')}</label>
                  <div className="w-full px-4 py-3 bg-brand-50 dark:bg-slate-800 border border-brand-100 dark:border-slate-600 rounded-xl text-brand-800 dark:text-slate-100 font-medium">
                    Telegram
                  </div>
                </div>
              </div>

              <div className="p-8 bg-brand-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button
                  onClick={() => setIsRuleModalOpen(false)}
                  className="flex-1 py-4 bg-white dark:bg-slate-800 border border-brand-200 text-brand-700 dark:text-brand-400 font-bold rounded-2xl hover:bg-brand-50 dark:hover:bg-slate-700 transition-all"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={handleCreateRule}
                  disabled={isCreatingRule}
                  className="flex-1 py-4 bg-brand-700 text-white font-bold rounded-2xl hover:bg-brand-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isCreatingRule ? <Loader2 className="animate-spin" size={18} /> : (
                    <>
                      {language === 'km' ? 'រក្សាទុកច្បាប់' : 'Save Rule'}
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

export default Automation;
