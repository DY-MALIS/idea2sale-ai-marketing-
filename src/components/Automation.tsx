import React, { useState, useEffect } from 'react';
import {
  MessagesSquare,
  Bot,
  Zap,
  Shield,
  MessageCircle,
  MousePointer2,
  RefreshCw,
  Plus,
  ArrowRight,
  Loader2,
  Settings,
  CheckCircle2,
  X,
  Calendar as CalendarIcon,
  Clock,
  AlertCircle,
  Inbox as InboxIcon,
  Send,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

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

interface Campaign {
  id: string;
  name: string;
  platform: string;
  frequency: string;
  status: 'Active' | 'Paused';
  userId: string;
  createdAt: any;
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
  const [activeTab, setActiveTab] = useState<'posting' | 'reply' | 'inbox'>('posting');
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [replyRules, setReplyRules] = useState<ReplyRule[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states for Posting
  const [campaignName, setCampaignName] = useState('');
  const [platform, setPlatform] = useState('TikTok');
  const [frequency, setFrequency] = useState('Daily');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal states for Reply
  const [ruleTrigger, setRuleTrigger] = useState('');
  const [ruleResponse, setRuleResponse] = useState('');
  const [rulePlatform, setRulePlatform] = useState('TikTok');
  const [isCreatingRule, setIsCreatingRule] = useState(false);

  // Inbox state
  const [inboxLeads, setInboxLeads] = useState<TelegramLead[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inboxMessages, setInboxMessages] = useState<TelegramMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'inbox') return;
    const q = query(collection(db, 'telegram_leads'), orderBy('lastMessageAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as TelegramLead[];
      setInboxLeads(data);
      setInboxLoading(false);
      setSelectedChatId((current) => current || data[0]?.chatId || null);
    }, (error) => {
      console.error('Inbox leads listener error:', error);
      setInboxLoading(false);
    });
    return () => unsubscribe();
  }, [activeTab]);

  useEffect(() => {
    if (!selectedChatId || activeTab !== 'inbox') return;
    setMessagesLoading(true);
    const q = query(
      collection(db, 'telegram_messages'),
      where('chatId', '==', selectedChatId),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setInboxMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as TelegramMessage[]);
      setMessagesLoading(false);
    }, (error) => {
      console.error('Inbox messages listener error:', error);
      setMessagesLoading(false);
    });
    return () => unsubscribe();
  }, [selectedChatId, activeTab]);

  useEffect(() => {
    let unsubscribe: () => void;

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    if (userToUse) {
      if (isDemoMode) {
        // Mock data for demo mode
        setCampaigns([
          { id: '1', name: 'Demo Campaign', platform: 'TikTok', frequency: 'Daily', status: 'Active', userId: 'demo-user', createdAt: null },
          { id: '2', name: 'Holiday Special', platform: 'Instagram', frequency: 'Weekly', status: 'Paused', userId: 'demo-user', createdAt: null }
        ]);
        setReplyRules([
          { id: '1', trigger: 'price', response: 'Hi! The price is $25.', platform: 'TikTok', userId: 'demo-user' },
          { id: '2', trigger: 'available', response: 'Yes, it is available!', platform: 'Facebook', userId: 'demo-user' }
        ]);
        setLoading(false);
      } else {
        const qC = query(
          collection(db, 'campaigns'),
          where('userId', '==', userToUse.uid)
        );

        const qR = query(
          collection(db, 'reply_rules'),
          where('userId', '==', userToUse.uid)
        );

        const unsubC = onSnapshot(qC, 
          (snapshot) => {
            const data = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })) as Campaign[];
            
            const sorted = data.sort((a, b) => {
              const dateA = a.createdAt?.toDate?.() || new Date(0);
              const dateB = b.createdAt?.toDate?.() || new Date(0);
              return dateB - dateA;
            });

            setCampaigns(sorted);
            if (activeTab === 'posting') setLoading(false);
          },
          (error) => {
            console.error("Firestore Error in Campaigns:", error);
            setLoading(false);
          }
        );

        const unsubR = onSnapshot(qR, 
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

        unsubscribe = () => {
          unsubC();
          unsubR();
        };
      }
    } else {
      setCampaigns([]);
      setReplyRules([]);
      setLoading(false);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, isDemoMode]);

  const [stats, setStats] = useState({ replies: 0, hours: 0, rate: 0 });
  const [tiktokConnected, setTiktokConnected] = useState(() => {
    return localStorage.getItem('tiktok_connected') === 'true';
  });
  const [isAutomationActive, setIsAutomationActive] = useState(() => {
    return localStorage.getItem('global_automation_active') !== 'false'; // Default to true if not set
  });
  const [isTraining, setIsTraining] = useState(false);

  const toggleGlobalAutomation = () => {
    const newState = !isAutomationActive;
    setIsAutomationActive(newState);
    localStorage.setItem('global_automation_active', newState ? 'true' : 'false');
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
      // Calculate real stats based on active campaigns
      const activeCount = campaigns.filter(c => c.status === 'Active').length;
      const hoursSaved = activeCount * 2.5; // Rough estimate: 2.5 hours per active campaign
      setStats({
        replies: activeCount * 15, // Mocking replies for now as we don't have a replies collection
        hours: Math.round(hoursSaved),
        rate: activeCount > 0 ? 82 : 0
      });
    }
  }, [campaigns, isDemoMode]);
  useEffect(() => {
    const checkTikTok = async () => {
      try {
        const res = await fetch('/api/tiktok/me');
        const data = await res.json();
        setTiktokConnected(!!data.display_name || !!data.open_id);
      } catch (e) {
        setTiktokConnected(false);
      }
    };
    if (!isDemoMode) {
      if (localStorage.getItem('tiktok_connected') === 'true') {
        setTiktokConnected(true);
      } else {
        checkTikTok();
      }
    }
  }, [isDemoMode]);

  const handleTikTokAuth = async () => {
    try {
      // In a real app, we use OAuth. For prototype, we open TikTok and help user simulate.
      window.open('https://www.tiktok.com/login', 'tiktokAuth', 'width=600,height=700');
      
      // Let the user know they can confirm manually in the UI
      setErrorMsg(language === 'km' 
        ? 'សូមចុចប៊ូតុង "បញ្ជាក់ការភ្ជាប់ (សាកល្បង)" ខាងក្រោម ដើម្បីបន្ត។' 
        : 'Please click the "Confirm Connection (Mock)" button below to continue.');
    } catch (err) {
      console.error(err);
    }
  };

  const confirmConnection = () => {
    setTiktokConnected(true);
    localStorage.setItem('tiktok_connected', 'true');
    setErrorMsg(null);
  };
  const handleCreateSchedule = async () => {
    if (!campaignName.trim()) {
      setErrorMsg(t('enterCampaignNameErr'));
      return;
    }
    
    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);
    if (!userToUse) {
      setErrorMsg(t('signInFirstErr'));
      return;
    }

    if (platform === 'TikTok' && !tiktokConnected && !isDemoMode) {
      setErrorMsg(t('connectTiktokFirstErr'));
      return;
    }

    setIsCreating(true);
    setErrorMsg(null);

    if (isDemoMode) {
      // Just simulate success in demo mode
      setTimeout(() => {
        setCampaigns(prev => [...prev, {
          id: Date.now().toString(),
          name: campaignName,
          platform,
          frequency,
          status: 'Active',
          userId: 'demo-user',
          createdAt: { toDate: () => new Date() }
        }]);
        setIsCreating(false);
        setIsScheduleModalOpen(false);
        setCampaignName('');
      }, 800);
      return;
    }

    try {
      await addDoc(collection(db, 'campaigns'), {
        name: campaignName,
        platform,
        frequency,
        status: 'Active',
        userId: userToUse.uid,
        createdAt: serverTimestamp()
      });
      setIsScheduleModalOpen(false);
      setCampaignName('');
    } catch (err: any) {
      console.error('Error creating campaign:', err);
      setErrorMsg(err.message || (language === 'km' ? 'ការបង្កើតយុទ្ធនាការមិនបានសម្រេច។ សូមព្យាយាមម្តងទៀត។' : 'Failed to create campaign. Please try again.'));
    } finally {
      setIsCreating(false);
    }
  };

  const toggleCampaignStatus = async (campaign: Campaign) => {
    const newStatus = campaign.status === 'Active' ? 'Paused' : 'Active';
    try {
      await updateDoc(doc(db, 'campaigns', campaign.id), {
        status: newStatus
      });
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const deleteCampaign = async (id: string) => {
    try {
      if (isDemoMode) {
        setCampaigns(prev => prev.filter(c => c.id !== id));
        return;
      }
      await deleteDoc(doc(db, 'campaigns', id));
    } catch (err: any) {
      console.error('Error deleting campaign:', err);
      const msg = err.message || '';
      if (msg.includes('insufficient permissions')) {
        setErrorMsg(language === 'km' ? 'អ្នកមិនមានការអនុញ្ញាតឱ្យលុបទិន្នន័យនេះទេ។' : 'You do not have permission to delete this.');
      } else {
        setErrorMsg(language === 'km' ? 'មិនអាចលុបបាន៖ ' + msg : 'Failed to delete: ' + msg);
      }
    }
  };

  const handleCreateRule = async () => {
    if (!ruleTrigger.trim() || !ruleResponse.trim()) {
      setErrorMsg(language === 'km' ? 'សូមបំពេញព័ត៌មានឱ្យបានគ្រប់គ្រាន់' : 'Please fill in all fields');
      return;
    }

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);
    if (!userToUse) return;

    setIsCreatingRule(true);
    setErrorMsg(null);

    if (isDemoMode) {
      setTimeout(() => {
        setReplyRules(prev => [...prev, {
          id: Date.now().toString(),
          trigger: ruleTrigger,
          response: ruleResponse,
          platform: rulePlatform,
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
        trigger: ruleTrigger,
        response: ruleResponse,
        platform: rulePlatform,
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
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
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
            <button 
              onClick={toggleGlobalAutomation}
              className="text-xs font-bold text-brand-600 hover:underline"
            >
              {isAutomationActive 
                ? (language === 'km' ? 'ចុចទីនេះដើម្បីបិទ' : 'Click to disable') 
                : (language === 'km' ? 'ចុចទីនេះដើម្បីបើកដំណើរការ' : 'Click to enable')
              }
            </button>
          </div>
          <p className="text-slate-500 mt-1 text-lg">{t('engagementTeam')}</p>
        </div>
        <div className="flex bg-brand-100/50 p-1.5 rounded-2xl border border-brand-200">
          <button 
            onClick={() => setActiveTab('posting')}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all", activeTab === 'posting' ? "bg-white text-brand-700 shadow-sm" : "text-brand-500 hover:bg-brand-50")}
          >
            {t('autoPosting')}
          </button>
          <button
            onClick={() => setActiveTab('reply')}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all", activeTab === 'reply' ? "bg-white text-brand-700 shadow-sm" : "text-brand-500 hover:bg-brand-50")}
          >
            {t('smartReply')}
          </button>
          <button
            onClick={() => setActiveTab('inbox')}
            className={cn("px-6 py-2.5 rounded-xl text-sm font-bold transition-all", activeTab === 'inbox' ? "bg-white text-brand-700 shadow-sm" : "text-brand-500 hover:bg-brand-50")}
          >
            {t('inboxLabel')}
          </button>
        </div>
      </header>

      {errorMsg && !isScheduleModalOpen && !isRuleModalOpen && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 flex items-center gap-3 shadow-sm"
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

      <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-700">
        <strong>{t('socialAutomation')}</strong>
        <span className="ml-2">{t('automationRoleDesc')}</span>
      </div>

      {activeTab === 'inbox' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 glass rounded-[2rem] overflow-hidden max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-brand-100 bg-brand-50 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-brand-700 flex items-center gap-2">
                <InboxIcon size={18} className="text-brand-500" />
                {t('inboxLabel')}
              </h3>
              <span className="text-[10px] font-bold text-slate-400">{inboxLeads.length}</span>
            </div>
            <div className="overflow-y-auto flex-1">
              {inboxLoading ? (
                <div className="flex justify-center p-10"><Loader2 className="animate-spin text-brand-400" /></div>
              ) : inboxLeads.length === 0 ? (
                <div className="text-center p-10">
                  <MessageCircle size={32} className="mx-auto text-brand-200 mb-3" />
                  <p className="text-sm text-slate-500">{t('noLeadsYet')}</p>
                </div>
              ) : (
                inboxLeads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedChatId(lead.chatId)}
                    className={cn(
                      'w-full text-left p-4 border-b border-brand-50 transition-colors',
                      selectedChatId === lead.chatId ? 'bg-brand-50' : 'hover:bg-brand-50/50'
                    )}
                  >
                    <p className="font-bold text-sm text-brand-700 truncate">{lead.displayName}</p>
                    <p className="text-xs text-slate-500 truncate">{lead.lastMessage}</p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-8 glass rounded-[2rem] overflow-hidden max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-brand-100 bg-brand-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Bot size={18} className="text-brand-500" />
                <h3 className="font-bold text-brand-700">
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
                <div className="text-center p-10 text-sm text-slate-400">{t('selectLeadPrompt')}</div>
              ) : messagesLoading ? (
                <div className="flex justify-center p-10"><Loader2 className="animate-spin text-brand-400" /></div>
              ) : inboxMessages.length === 0 ? (
                <div className="text-center p-10 text-sm text-slate-400">{t('noLeadsYet')}</div>
              ) : (
                inboxMessages.map((msg) => (
                  <div key={msg.id} className={cn('flex', msg.direction === 'in' ? 'justify-start' : 'justify-end')}>
                    <div className={cn(
                      'max-w-[75%] px-4 py-3 rounded-2xl text-sm',
                      msg.direction === 'in' ? 'bg-brand-50 text-brand-700' : 'bg-brand-700 text-white'
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
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {activeTab === 'posting' ? (
            <div className="glass p-10 rounded-[2.5rem] shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-brand-700">{t('autoPostEngine')}</h3>
                  <p className="text-slate-500 text-sm">{t('autoPostDesc')}</p>
                </div>
                <button 
                  onClick={() => {
                    setIsScheduleModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-700 text-white rounded-xl font-bold hover:bg-brand-800 transition-all active:scale-95"
                >
                  <Plus size={20} />
                  {t('newScheduleBtn')}
                </button>
              </div>

              <div className="space-y-6">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Loader2 className="animate-spin text-brand-500" size={32} />
                    <p className="text-slate-400 text-sm font-medium">{t('syncCampaigns')}</p>
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="text-center py-20 bg-brand-50/30 rounded-[2.5rem] border border-dashed border-brand-200">
                    <CalendarIcon size={48} className="mx-auto text-brand-200 mb-4" />
                    <h4 className="text-brand-700 font-bold mb-1">{t('noActiveCampaigns')}</h4>
                    <p className="text-sm text-slate-500">{t('createFirstSchedule')}</p>
                  </div>
                ) : (
                  campaigns.map((campaign) => (
                    <div key={campaign.id} className="flex items-center justify-between p-6 bg-brand-50/50 rounded-[2rem] border border-brand-100 relative group overflow-hidden">
                      <div className={`absolute top-0 left-0 w-1 h-full ${campaign.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-brand-100 overflow-hidden flex items-center justify-center">
                          <Zap size={24} className={campaign.status === 'Active' ? "text-brand-500" : "text-slate-300"} />
                        </div>
                        <div>
                          <h4 className="font-bold text-brand-700">{campaign.name}</h4>
                          <p className="text-xs text-slate-500 font-medium">
                            {campaign.platform} • {campaign.frequency} • {campaign.status === 'Active' ? t('enabled') : t('paused')}
                          </p>
                        </div>
                      </div>
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => toggleCampaignStatus(campaign)}
                            className={cn(
                              "flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full transition-all",
                              campaign.status === 'Active' 
                                ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" 
                                : "text-slate-500 bg-slate-100 hover:bg-slate-200"
                            )}
                          >
                            {campaign.status === 'Active' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                            {campaign.status === 'Active' ? t('enabled') : t('paused')}
                          </button>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => deleteCampaign(campaign.id)}
                              className="p-3 bg-white hover:bg-red-50 text-red-400 rounded-xl transition-all border border-brand-100 shadow-sm"
                            >
                              <X size={18} />
                            </button>
                          </div>
                        </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="glass p-10 rounded-[2.5rem] shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-brand-700">{t('smartAiReplies')}</h3>
                  <p className="text-slate-500 text-sm">{t('aiReplyDesc')}</p>
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

              <div className="mb-6 p-4 bg-sky-50 border border-sky-100 rounded-2xl text-sm text-sky-700">
                {t('telegramRulesLiveNote')}
              </div>

              <div className="space-y-4">
                {replyRules.length === 0 ? (
                  <div className="text-center py-20 bg-brand-50/30 rounded-[2.5rem] border border-dashed border-brand-200">
                    <MessageCircle size={48} className="mx-auto text-brand-200 mb-4" />
                    <h4 className="text-brand-700 font-bold mb-1">{language === 'km' ? 'មិនទាន់មានច្បាប់ឆ្លើយតបនៅឡើយទេ' : 'No reply rules yet'}</h4>
                    <p className="text-sm text-slate-500">{language === 'km' ? 'បង្កើតច្បាប់ដំបូងរបស់អ្នកដើម្បីសន្សំសំចៃពេលវេលា' : 'Create your first rule to save time'}</p>
                  </div>
                ) : (
                  replyRules.map((rule, i) => (
                    <div key={rule.id} className="p-6 bg-brand-50/50 rounded-3xl border border-brand-100 hover:bg-white transition-all group relative">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-brand-400 uppercase tracking-widest bg-white px-2 py-1 rounded border border-brand-100">{t('commentContains')}</span>
                          <span className="font-bold text-brand-700">"{rule.trigger}"</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-slate-400 font-bold">{rule.platform}</span>
                          <button 
                            onClick={() => deleteRule(rule.id)}
                            className="p-2 bg-white hover:bg-red-50 text-red-400 rounded-lg border border-brand-100 shadow-sm"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-white p-4 rounded-2xl border border-brand-50 italic text-brand-600 text-sm">
                        <MessageCircle size={18} className="shrink-0 text-brand-400" />
                        "{rule.response}"
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
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
            <h3 className="font-bold text-brand-700 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={20} className={isAutomationActive ? "text-amber-500" : "text-slate-300"} />
                {t('engagementStats')}
              </div>
              {isAutomationActive && <span className="text-[10px] text-emerald-500 animate-pulse font-bold">Auto-Sync ON</span>}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-brand-50 px-4 py-6 rounded-2xl border border-brand-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('totalReplies')}</p>
                <p className="text-2xl font-bold text-brand-700">{stats.replies.toLocaleString()}</p>
              </div>
              <div className="bg-brand-50 px-4 py-6 rounded-2xl border border-brand-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('timeSaved')}</p>
                <p className="text-2xl font-bold text-brand-700">{stats.hours}h</p>
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
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsScheduleModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-brand-50/30">
                <div>
                  <h3 className="text-2xl font-bold text-brand-700">{t('newSchedule')}</h3>
                  <p className="text-slate-500 text-sm">{t('automationSubtitle')}</p>
                </div>
                <button onClick={() => setIsScheduleModalOpen(false)} className="p-2 hover:bg-white rounded-xl transition-all">
                  <X size={20} className="text-brand-400" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                {errorMsg && (
                  <div className="p-4 bg-red-50 text-red-600 rounded-xl flex flex-col gap-3 text-sm border border-red-100">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={16} />
                      {errorMsg}
                    </div>
                    {errorMsg.includes(language === 'km' ? 'ភ្ជាប់' : 'connect') && (
                      <div className="flex flex-col gap-2 mt-2">
                        <button 
                          onClick={handleTikTokAuth}
                          className="py-2 bg-black text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-900 transition-all"
                        >
                          <RefreshCw size={14} />
                          {language === 'km' ? 'ភ្ជាប់ TikTok ឥឡូវនេះ' : 'Connect TikTok Now'}
                        </button>
                        
                        <button 
                          type="button"
                          onClick={confirmConnection}
                          className="py-2 bg-brand-100 text-brand-700 border border-brand-200 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-brand-200 transition-all"
                        >
                          <Zap size={14} />
                          {language === 'km' ? 'បញ្ជាក់ការភ្ជាប់ (សាកល្បង)' : 'Confirm Connection (Mock)'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{t('campaignName')}</label>
                  <input 
                    type="text" 
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder={t('campaignNamePlaceholder')} 
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 ring-brand-500/20" 
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{t('platform')}</label>
                    <select 
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      className="w-full px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-800 focus:outline-none font-medium"
                    >
                      <option>TikTok</option>
                      <option>Facebook</option>
                      <option>Instagram</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{t('frequency')}</label>
                    <select 
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value)}
                      className="w-full px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-800 focus:outline-none font-medium"
                    >
                      <option value="Daily">{t('daily')}</option>
                      <option value="Weekly">{t('weekly')}</option>
                      <option value="Custom">{t('custom')}</option>
                    </select>
                  </div>
                </div>

                <div className="p-4 bg-brand-50 rounded-2xl border border-brand-100 text-sm text-brand-600 flex gap-3">
                  <CalendarIcon className="shrink-0 text-brand-400" size={20} />
                  {t('bestTimeSuggestion')}
                </div>
              </div>

              <div className="p-8 bg-brand-50/50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setIsScheduleModalOpen(false)}
                  className="flex-1 py-4 bg-white border border-brand-200 text-brand-700 font-bold rounded-2xl hover:bg-brand-50 transition-all"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={handleCreateSchedule}
                  disabled={isCreating}
                  className="flex-1 py-4 bg-brand-700 text-white font-bold rounded-2xl hover:bg-brand-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isCreating ? <Loader2 className="animate-spin" size={18} /> : (
                    <>
                      {t('createSchedule')}
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

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
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-brand-50/30">
                <div>
                  <h3 className="text-2xl font-bold text-brand-700">{t('addRule')}</h3>
                  <p className="text-slate-500 text-sm">{t('aiReplyDesc')}</p>
                </div>
                <button onClick={() => setIsRuleModalOpen(false)} className="p-2 hover:bg-white rounded-xl transition-all">
                  <X size={20} className="text-brand-400" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                {errorMsg && (
                  <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-sm border border-red-100">
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
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 ring-brand-500/20" 
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{language === 'km' ? 'ការឆ្លើយតប (Response)' : 'AI Response'}</label>
                  <textarea 
                    value={ruleResponse}
                    onChange={(e) => setRuleResponse(e.target.value)}
                    placeholder={language === 'km' ? 'បញ្ចូលការឆ្លើយតបរបស់អ្នក...' : 'Enter your automated response...'} 
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 ring-brand-500/20 h-24 resize-none" 
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-brand-400 uppercase tracking-widest mb-2">{t('platform')}</label>
                  <select
                    value={rulePlatform}
                    onChange={(e) => setRulePlatform(e.target.value)}
                    className="w-full px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-800 focus:outline-none font-medium"
                  >
                    <option>TikTok</option>
                    <option>Facebook</option>
                    <option>Instagram</option>
                    <option value="TELEGRAM">Telegram</option>
                  </select>
                </div>
              </div>

              <div className="p-8 bg-brand-50/50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setIsRuleModalOpen(false)}
                  className="flex-1 py-4 bg-white border border-brand-200 text-brand-700 font-bold rounded-2xl hover:bg-brand-50 transition-all"
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
