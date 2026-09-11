import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { useAuth } from '../contexts/AuthContext';
import { ensureBusinessInInboxMessage, getLatestBusinessBranding } from '../lib/businessBranding';
import {
  AlertCircle,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Facebook,
  FileSpreadsheet,
  Heart,
  Loader2,
  Mail,
  MessageCircle,
  Radar,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  Video,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { CreativeAutomationRequest, FacebookPotentialLead, FacebookScanResult, FacebookVideoPlanItem } from '../types';
import { deleteGenerationHistory, GenerationHistoryEntry, saveGenerationHistory, useGenerationHistory } from '../lib/generationHistory';
import HistoryPanel from './HistoryPanel';
import { downloadCsv } from '../lib/csvExport';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface FacebookScannerProps {
  onCreativeAutomation: (request: CreativeAutomationRequest) => void;
}

const countryOptions = [
  { code: 'KH', label: 'Cambodia' },
  { code: 'TH', label: 'Thailand' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'US', label: 'United States' },
];

const FacebookScanner: React.FC<FacebookScannerProps> = ({ onCreativeAutomation }) => {
  const { language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const isKm = language === 'km';
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('KH');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FacebookScanResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLead, setCopiedLead] = useState<number | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [deselectedLeads, setDeselectedLeads] = useState<Set<number>>(new Set());

  const toggleLeadSelection = (index: number) => {
    setDeselectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const exportLeadsToExcel = () => {
    const leads = result?.potentialLeads || [];
    const selected = leads.filter((_, index) => !deselectedLeads.has(index));
    if (!selected.length) return;
    const headers = isKm
      ? ['ឈ្មោះក្រុមហ៊ុន', 'ប្រភេទអាជីវកម្ម', 'អាសយដ្ឋាន', 'ទូរស័ព្ទ', 'អ៊ីមែល', 'Telegram', 'គេហទំព័រ', 'Facebook Page', 'កម្រិត Lead', 'សេវាកម្មដែលណែនាំ', 'សារ Inbox', 'ប្រភព']
      : ['Business Name', 'Business Type', 'Address', 'Phone', 'Email', 'Telegram', 'Website', 'Facebook Page', 'Lead Level', 'Recommended Service', 'Inbox Message', 'Source URL'];
    const rows = selected.map((lead) => [
      lead.businessName,
      lead.businessType,
      lead.address || '',
      lead.phone || '',
      lead.email || '',
      lead.telegram || '',
      lead.website || '',
      lead.facebookUrl || lead.facebookPageName || '',
      lead.leadLevel,
      lead.recommendedService,
      ensureBusinessInInboxMessage(lead.inboxMessage, businessName),
      lead.evidenceSourceUrl || '',
    ]);
    const safeQuery = query.trim().slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-') || 'leads';
    downloadCsv(`${safeQuery}-${new Date().toISOString().slice(0, 10)}.csv`, [headers, ...rows]);
  };

  // Telegram bots can't message an arbitrary user first -- only the lead
  // clicking their own "Start" button can open the conversation. So this
  // stores the pitch context under a short id and copies a t.me deep link
  // for the owner to send the lead (email, Facebook DM, etc.); once clicked,
  // api/telegram/webhook.js reads this doc back and sends an AI-generated
  // opening message instead of the generic /start welcome.
  const startBotChat = async (lead: FacebookPotentialLead, index: number) => {
    if (!user || isDemoMode || !telegramBotActive || !telegramBotUsername) return;
    try {
      const leadDoc = await addDoc(collection(db, 'facebook_scan_leads'), {
        ownerId: user.uid,
        businessName: lead.businessName.slice(0, 200),
        businessType: lead.businessType.slice(0, 120),
        recommendedService: (lead.recommendedService || '').slice(0, 500),
        inboxMessage: ensureBusinessInInboxMessage(lead.inboxMessage, businessName).slice(0, 1500),
        needSignals: (lead.needSignals || []).slice(0, 5),
        createdAt: serverTimestamp(),
      });
      const link = `https://t.me/${telegramBotUsername}?start=${leadDoc.id}`;
      await navigator.clipboard.writeText(link);
      setChattingLeadIndex(index);
      window.setTimeout(() => setChattingLeadIndex((current) => (current === index ? null : current)), 2500);
    } catch (error) {
      console.error('Failed to create bot chat link:', error);
    }
  };

  const [emailSendingIndex, setEmailSendingIndex] = useState<number | null>(null);
  const [emailSentIndex, setEmailSentIndex] = useState<number | null>(null);
  // Kept separate from the top-of-page `error` (used for scan failures) so a
  // failed "Send Email" click on one lead card shows its error next to that
  // button instead of jumping to the top and looking like the scan itself
  // (an unrelated action) just failed.
  const [emailError, setEmailError] = useState<{ index: number; message: string } | null>(null);

  // Unlike Telegram, email has no "must message us first" restriction, so
  // this can actually send automatically instead of just copying a link.
  const sendLeadEmail = async (lead: FacebookPotentialLead, index: number) => {
    if (!user || isDemoMode || !lead.email) return;
    setEmailSendingIndex(index);
    setEmailError(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'sendOutreachEmail',
          to: lead.email,
          subject: businessName || (isKm ? 'សេចក្តីណែនាំពីអាជីវកម្មរបស់យើង' : 'A quick introduction'),
          body: ensureBusinessInInboxMessage(lead.inboxMessage, businessName),
          fromName: businessName || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Failed to send email.');
      setEmailSentIndex(index);
      window.setTimeout(() => setEmailSentIndex((current) => (current === index ? null : current)), 2500);
    } catch (err: any) {
      setEmailError({ index, message: err?.message || (isKm ? 'មិនអាចផ្ញើអ៊ីមែលបានទេ។' : 'Could not send the email.') });
    } finally {
      setEmailSendingIndex(null);
    }
  };

  const [telegramBotUsername, setTelegramBotUsername] = useState('');
  const [telegramBotActive, setTelegramBotActive] = useState(false);
  const [chattingLeadIndex, setChattingLeadIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLatestBusinessBranding(user, isDemoMode).then((branding) => {
      if (cancelled) return;
      setBusinessName(branding.businessName);
      setTelegramBotUsername(branding.telegramBotUsername);
      setTelegramBotActive(branding.telegramBotActive);
    });
    return () => { cancelled = true; };
  }, [user, isDemoMode]);

  const text = isKm ? {
    eyebrow: 'Facebook Audience Intelligence',
    title: 'ស្គេនអតិថិជន និងគូប្រជែង',
    subtitle: 'វិភាគតម្រូវការ ចំណង់ចំណូលចិត្ត គូប្រជែង និងបង្កើតកាលវិភាគវីដេអូដោយ AI។',
    sourceTitle: 'ទិន្នន័យមានសុវត្ថិភាព និងគោរពឯកជនភាព',
    sourceBody: 'ប្រើតែ Facebook Ad Library សាធារណៈ និងទិន្នន័យដែលអ្នកមានសិទ្ធិចូលប្រើ។ វាមិនចូលមើល profile ឯកជន សារ ឬពាក្យសម្ងាត់អតិថិជនទេ។',
    query: 'ផលិតផល ទីផ្សារ ឬឈ្មោះ Page គូប្រជែង',
    placeholder: 'ឧ. ហាងសម្លៀកបំពាក់នារី, skincare Cambodia, ឈ្មោះ Page...',
    market: 'ទីផ្សារគោលដៅ',
    duration: 'ផែនការវីដេអូ',
    days: 'ថ្ងៃ',
    scan: 'ចាប់ផ្តើមស្គេន និងធ្វើផែនការ',
    scanning: 'AI កំពុងវិភាគទិន្នន័យ...',
    bought: 'អ្វីដែលពួកគេទិញ និងត្រូវការ',
    likes: 'អ្វីដែលពួកគេចូលចិត្ត',
    content: 'Content ដែលពួកគេចង់មើល',
    personas: 'ក្រុមអតិថិជនគោលដៅ',
    competitors: 'ការវិភាគគូប្រជែង',
    leads: 'អាជីវកម្មដែលអាចក្លាយជាអតិថិជន',
    leadSource: 'រកឃើញតាមរយៈការស្វែងរកលើវេប (OpenRouter)',
    exportContacts: 'នាំចេញជា Excel',
    chatViaBot: 'ជជែកតាម Bot',
    sendEmail: 'ផ្ញើអ៊ីមែល',
    emailSent: 'បានផ្ញើ!',
    noVerifiedLeads: 'មិនទាន់មាន Lead ដែលបានផ្ទៀងផ្ទាត់ទេ។ សូមសាកល្បងស្គេនម្តងទៀត ដើម្បីទទួលបានឈ្មោះអាជីវកម្មពិត។',
    noVerifiedCompetitors: 'ការស្វែងរកលើវេបផ្ទាល់មិនរកឃើញឈ្មោះគូប្រកួតប្រជែងពិតដែលអាចផ្ទៀងផ្ទាត់បានទេ។ ប្រព័ន្ធនឹងមិនស្មានឈ្មោះឡើយ។',
    needSignals: 'សញ្ញាថាត្រូវការ Content/Video',
    recommendedService: 'សេវាកម្មដែលគួរផ្តល់ជូន',
    publicContact: 'ព័ត៌មានទំនាក់ទំនងសាធារណៈ',
    viewPage: 'បើក Facebook Page',
    viewEvidence: 'មើលប្រភពផ្សាយពាណិជ្ជកម្ម',
    copyInbox: 'ចម្លងសារ Inbox',
    angle: 'ទិសដៅសំខាន់',
    offer: 'យុទ្ធសាស្ត្រផ្តល់ជូន',
    weakness: 'ចំណុចខ្សោយ',
    counter: 'ឱកាសរបស់យើង',
    plan: 'កាលវិភាគបង្កើតវីដេអូ',
    create: 'បង្កើតវីដេអូនេះ',
    report: 'របាយការណ៍យុទ្ធសាស្ត្រ',
    copy: 'ចម្លងរបាយការណ៍',
    copied: 'បានចម្លង',
    live: 'ការស្វែងរកលើវេបបានភ្ជាប់',
    estimated: 'AI market estimate',
    webBusinesses: 'Lead ពិតដែលបានផ្ទៀងផ្ទាត់',
    viewMap: 'មើលលើ Google Maps',
    call: 'ទូរស័ព្ទ',
    visitWebsite: 'ចូលទស្សនាគេហទំព័រ',
    address: 'អាសយដ្ឋាន',
    email: 'អ៊ីមែល',
    telegram: 'Telegram',
    companyName: 'ឈ្មោះក្រុមហ៊ុន',
    facebookPage: 'Facebook Page / Channel',
    publicContacts: 'ព័ត៌មានទំនាក់ទំនងសាធារណៈ',
    notFoundPublic: 'រកមិនឃើញជាសាធារណៈ',
    tryAsking: 'ឬសាកល្បងសួរ៖',
    suggestions: [
      'ហាងសម្លៀកបំពាក់នារី',
      'Skincare Cambodia',
      'ភោជនីយដ្ឋានកម្ពុជា',
      'សេវាកម្មសម្ផស្ស និង Spa',
      'អចលនទ្រព្យ ភ្នំពេញ',
    ],
  } : {
    eyebrow: 'Facebook Audience Intelligence',
    title: 'Customer & competitor scanner',
    subtitle: 'Understand demand, preferences and competitors, then turn the findings into an AI video calendar.',
    sourceTitle: 'Privacy-safe research',
    sourceBody: 'Uses public Facebook Ad Library data and sources you are authorized to access. It never reads private profiles, messages, or customer passwords.',
    query: 'Product, market, or competitor Page',
    placeholder: 'e.g. women’s fashion, skincare Cambodia, competitor Page name…',
    market: 'Target market',
    duration: 'Video plan',
    days: 'days',
    scan: 'Scan audience & build plan',
    scanning: 'AI is analyzing the market…',
    bought: 'What they buy and need',
    likes: 'What they appreciate',
    content: 'Content they want to see',
    personas: 'Target customer groups',
    competitors: 'Competitor intelligence',
    leads: 'Potential content-production clients',
    leadSource: 'Discovered via web search (OpenRouter)',
    exportContacts: 'Export to Excel',
    chatViaBot: 'Chat via Bot',
    sendEmail: 'Send Email',
    emailSent: 'Sent!',
    noVerifiedLeads: 'No verified leads yet. Try scanning again to receive real business names.',
    noVerifiedCompetitors: 'Live web search found no real, verifiable competitor names. The system will not guess any.',
    needSignals: 'Signals they may need content/video',
    recommendedService: 'Recommended service',
    publicContact: 'Public contact',
    viewPage: 'Open Facebook Page',
    viewEvidence: 'View public ad evidence',
    copyInbox: 'Copy Inbox message',
    angle: 'Leading angle',
    offer: 'Offer strategy',
    weakness: 'Weakness',
    counter: 'Our opportunity',
    plan: 'Video production calendar',
    create: 'Create this video',
    report: 'Strategy report',
    copy: 'Copy report',
    copied: 'Copied',
    live: 'Web search connected',
    estimated: 'AI market estimate',
    webBusinesses: 'verified leads',
    viewMap: 'View on Google Maps',
    call: 'Call',
    visitWebsite: 'Visit website',
    address: 'Address',
    email: 'Email',
    telegram: 'Telegram',
    companyName: 'Company name',
    facebookPage: 'Facebook Page / Channel',
    publicContacts: 'Public contact details',
    notFoundPublic: 'Not found publicly',
    tryAsking: 'Or try asking:',
    suggestions: [
      "Women's fashion shop",
      'Skincare Cambodia',
      'Cambodia restaurant',
      'Beauty salon & spa services',
      'Real estate Phnom Penh',
    ],
  };

  const scan = async () => {
    const cleanQuery = query.trim();
    if (!cleanQuery || loading) return;
    setLoading(true);
    setError('');
    try {
      const businessContext = await getLatestBusinessBranding(user, isDemoMode);
      const currentBusinessName = businessContext.businessName;
      setBusinessName(currentBusinessName);
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'facebookIntelligenceScan',
          query: cleanQuery,
          countries: [country],
          days,
          language,
          businessName: currentBusinessName,
          businessContext,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Facebook research could not be completed.');
      setResult(data as FacebookScanResult);
      setDeselectedLeads(new Set());
      const leadCount = Array.isArray(data.potentialLeads) ? data.potentialLeads.length : 0;
      void saveGenerationHistory({
        user, isDemoMode, type: 'facebook_scan',
        title: cleanQuery,
        summary: isKm ? `Lead ចំនួន ${leadCount}` : `${leadCount} lead${leadCount === 1 ? '' : 's'} found`,
        payload: { query: cleanQuery, country, days, result: data },
      }).catch((historyError) => console.error('Failed to save scan history:', historyError));
    } catch (scanError: any) {
      setError(scanError?.message || (isKm ? 'មិនអាចវិភាគបានទេ។ សូមព្យាយាមម្តងទៀត។' : 'The scan failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const scanHistory = useGenerationHistory(user, isDemoMode, 'facebook_scan');
  const restoreScanHistory = (entry: GenerationHistoryEntry) => {
    const payload = (entry.payload || {}) as Record<string, unknown>;
    if (typeof payload.query === 'string') setQuery(payload.query);
    if (typeof payload.country === 'string') setCountry(payload.country);
    if (typeof payload.days === 'number') setDays(payload.days);
    if (payload.result) setResult(payload.result as FacebookScanResult);
    setDeselectedLeads(new Set());
  };
  const deleteScanHistory = (id: string) => { void deleteGenerationHistory({ user, isDemoMode, type: 'facebook_scan', id }); };

  const createVideo = (item: FacebookVideoPlanItem) => {
    onCreativeAutomation({
      id: `facebook-scan-${Date.now()}-${item.date}`,
      kind: 'video',
      prompt: `${item.prompt}\n\nPerformance direction: ${item.performanceStyle}\nHook: ${item.hook}`,
      platform: 'Facebook',
      aspectRatio: '9:16',
      language: 'km',
      voiceOverText: item.voiceOverText,
      duration: 8,
    });
  };

  const copyReport = async () => {
    if (!result?.summaryReport) return;
    await navigator.clipboard.writeText(result.summaryReport);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const copyInboxMessage = async (message: string, index: number) => {
    await navigator.clipboard.writeText(message);
    setCopiedLead(index);
    window.setTimeout(() => setCopiedLead(null), 1800);
  };

  const leadBadgeClass = (level: 'Hot' | 'Warm' | 'Cold') => level === 'Hot'
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
    : level === 'Warm'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

  const insightCards = result ? [
    { title: text.bought, icon: ShoppingBag, items: result.customerInsights.whatTheyBought, iconClass: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300' },
    { title: text.likes, icon: Heart, items: result.customerInsights.whatTheyLike, iconClass: 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300' },
    { title: text.content, icon: Video, items: result.customerInsights.contentDesires, iconClass: 'bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300' },
  ] : [];

  return (
    <div className="space-y-8 pb-12">
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#1877F2] via-blue-600 to-indigo-700 p-8 text-white shadow-2xl shadow-blue-500/20">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative grid gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
              <Facebook size={15} /> {text.eyebrow}
            </div>
            <h2 className="max-w-3xl text-3xl font-black tracking-tight md:text-5xl">{text.title}</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-100 md:text-base">{text.subtitle}</p>
          </div>
          <div className="rounded-3xl border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={22} />
              <div>
                <p className="font-bold">{text.sourceTitle}</p>
                <p className="mt-1 text-xs leading-6 text-blue-100">{text.sourceBody}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="glass rounded-[2rem] p-6 md:p-8">
        <div className="grid gap-5 lg:grid-cols-[1fr_190px_150px]">
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.query}</span>
            <div className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-white/80 px-4 dark:bg-slate-900/70">
              <Search className="shrink-0 text-brand-500" size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void scan()}
                placeholder={text.placeholder}
                className="h-14 w-full bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-medium text-slate-400">{text.tryAsking}</span>
              {text.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuery(suggestion)}
                  className="rounded-full border border-brand-200 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 dark:border-brand-800 dark:bg-slate-900/60 dark:text-brand-300 dark:hover:bg-slate-800"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.market}</span>
            <select value={country} onChange={(event) => setCountry(event.target.value)} className="h-14 w-full rounded-2xl border border-brand-200 bg-white/80 px-4 text-sm font-bold text-slate-700 outline-none dark:bg-slate-900/70 dark:text-white">
              {countryOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.duration}</span>
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="h-14 w-full rounded-2xl border border-brand-200 bg-white/80 px-4 text-sm font-bold text-slate-700 outline-none dark:bg-slate-900/70 dark:text-white">
              {[3, 7, 10, 14].map((value) => <option key={value} value={value}>{value} {text.days}</option>)}
            </select>
          </label>
        </div>
        <button onClick={() => void scan()} disabled={loading || !query.trim()} className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#1877F2] to-indigo-600 py-4 font-bold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" size={20} /> : <Radar size={20} />}
          {loading ? text.scanning : text.scan}
        </button>
        {error && <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><AlertCircle className="shrink-0" size={18} />{error}</div>}
      </section>

      <HistoryPanel entries={scanHistory} onRestore={restoreScanHistory} onDelete={deleteScanHistory} />

      {result && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${result.webSearchAvailable ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
              {result.webSearchAvailable ? <Check size={15} /> : <Sparkles size={15} />}
              {result.webSearchAvailable ? text.live : text.estimated}
            </span>
            {!!result.webSearchAvailable && <span className="rounded-full bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{result.potentialLeads?.length || 0} {text.webBusinesses}</span>}
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            {insightCards.map(({ title, icon: Icon, items, iconClass }) => (
              <article key={title} className="glass rounded-[2rem] p-6">
                <div className="mb-5 flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconClass}`}><Icon size={21} /></span>
                  <h3 className="font-black text-slate-800 dark:text-white">{title}</h3>
                </div>
                <ul className="space-y-3">
                  {items.map((item, index) => <li key={index} className="flex gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><Check className="mt-1 shrink-0 text-emerald-500" size={15} /><span>{item}</span></li>)}
                </ul>
              </article>
            ))}
          </div>

          {!!result.customerInsights.targetPersonas.length && (
            <section>
              <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><Users className="text-blue-500" />{text.personas}</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {result.customerInsights.targetPersonas.map((persona, index) => (
                  <article key={`${persona.name}-${index}`} className="glass rounded-3xl p-5">
                    <p className="font-black text-brand-700 dark:text-brand-300">{persona.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{persona.description}</p>
                    <div className="mt-4 flex gap-2 rounded-2xl bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200"><Target className="shrink-0" size={16} />{persona.buyingTriggers}</div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><BarChart3 className="text-indigo-500" />{text.competitors}</h3>
            {result.competitors.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {result.competitors.map((competitor, index) => (
                  <article key={`${competitor.pageName}-${index}`} className="glass rounded-3xl p-6">
                    <div className="mb-4 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-black text-white">{index + 1}</span><h4 className="text-lg font-black text-slate-800 dark:text-white">{competitor.pageName}</h4></div>
                    <dl className="grid gap-3 text-sm">
                      <div><dt className="font-bold text-slate-400">{text.angle}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.topAngle}</dd></div>
                      <div><dt className="font-bold text-slate-400">{text.offer}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.offerStrategy}</dd></div>
                      <div><dt className="font-bold text-rose-500">{text.weakness}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.weakness}</dd></div>
                      <div className="rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-950/30"><dt className="font-bold text-emerald-700 dark:text-emerald-300">{text.counter}</dt><dd className="mt-1 text-emerald-800 dark:text-emerald-100">{competitor.counterStrategy}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/70 p-6 text-sm leading-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{text.noVerifiedCompetitors}</div>
            )}
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><BriefcaseBusiness className="text-emerald-500" />{text.leads}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{text.leadSource}</p>
                {!isDemoMode && !!user && !telegramBotActive && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {isKm ? 'ភ្ជាប់ Telegram Bot ក្នុង Business Profile ដើម្បីជជែកជាមួយ Lead ដោយផ្ទាល់' : 'Connect your Telegram bot in Business Profile to chat with leads directly'}
                  </p>
                )}
              </div>
              {!!result.potentialLeads?.length && (
                <button
                  type="button"
                  onClick={exportLeadsToExcel}
                  disabled={deselectedLeads.size === result.potentialLeads.length}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FileSpreadsheet size={16} />
                  {text.exportContacts}
                </button>
              )}
            </div>
            {result.potentialLeads?.length ? (
              <div className="grid gap-5 xl:grid-cols-2">
                {result.potentialLeads.map((lead, index) => (
                  <article key={`${lead.pageName}-${index}`} className="glass rounded-3xl p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={!deselectedLeads.has(index)}
                          onChange={() => toggleLeadSelection(index)}
                          className="mt-1.5 h-4 w-4 shrink-0 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                        />
                        <div>
                          <h4 className="text-lg font-black text-slate-800 dark:text-white">{lead.businessName}</h4>
                          <p className="mt-1 text-sm font-bold text-brand-500">{lead.businessType}</p>
                        </div>
                      </label>
                      <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider ${leadBadgeClass(lead.leadLevel)}`}>{lead.leadLevel}</span>
                    </div>

                    <div className="mt-5">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400">{text.needSignals}</p>
                      <ul className="mt-2 space-y-2">
                        {lead.needSignals.map((signal, signalIndex) => <li key={signalIndex} className="flex gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><Check className="mt-1 shrink-0 text-emerald-500" size={15} />{signal}</li>)}
                      </ul>
                    </div>

                    <div className="mt-4 rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
                      <p className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">{text.recommendedService}</p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900 dark:text-emerald-100">{lead.recommendedService}</p>
                    </div>

                    <div className="mt-4 rounded-2xl border border-brand-100 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-wider text-brand-500">
                        <MessageCircle size={15} />Inbox
                        {businessName && <span className="rounded-full bg-brand-50 px-2 py-1 normal-case tracking-normal text-brand-700 dark:bg-slate-800 dark:text-brand-300">{isKm ? 'ផ្ញើពី' : 'From'} {businessName}</span>}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{ensureBusinessInInboxMessage(lead.inboxMessage, businessName)}</p>
                    </div>

                    <div className="mt-4 space-y-1 rounded-2xl border border-brand-100 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                        <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">{text.publicContacts}</p>
                        <p><span className="font-bold text-slate-400">{text.companyName}: </span>{lead.businessName}</p>
                        {lead.address && <p><span className="font-bold text-slate-400">{text.address}: </span>{lead.address}</p>}
                        {lead.phone && <p><span className="font-bold text-slate-400">{text.call}: </span>{lead.phone}</p>}
                        <p><span className="font-bold text-slate-400">{text.email}: </span>{lead.email ? <a className="font-semibold text-blue-600 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="text-slate-400">{text.notFoundPublic}</span>}</p>
                        <p><span className="font-bold text-slate-400">{text.telegram}: </span>{lead.telegram ? (/^(?:https?:\/\/|@)/i.test(lead.telegram) ? <a className="font-semibold text-sky-600 hover:underline" href={lead.telegram.startsWith('@') ? `https://t.me/${lead.telegram.slice(1)}` : lead.telegram} target="_blank" rel="noopener noreferrer">{lead.telegram}</a> : lead.telegram) : <span className="text-slate-400">{text.notFoundPublic}</span>}</p>
                        <p><span className="font-bold text-slate-400">{text.facebookPage}: </span>{lead.facebookUrl ? <a className="font-semibold text-blue-600 hover:underline" href={lead.facebookUrl} target="_blank" rel="noopener noreferrer">{lead.facebookPageName || lead.businessName}</a> : (lead.facebookPageName || <span className="text-slate-400">{text.notFoundPublic}</span>)}</p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {lead.facebookUrl && <a href={lead.facebookUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} />{text.viewPage}</a>}
                      {lead.evidenceSourceUrl && <a href={lead.evidenceSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-3 py-2 text-xs font-bold text-brand-700 dark:bg-slate-900 dark:text-brand-300"><ExternalLink size={14} />{text.viewEvidence}</a>}
                      {lead.mapsUrl && <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} />{text.viewMap}</a>}
                      {lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-3 py-2 text-xs font-bold text-brand-700 dark:bg-slate-900 dark:text-brand-300"><ExternalLink size={14} />{text.visitWebsite}</a>}
                      <button onClick={() => void copyInboxMessage(ensureBusinessInInboxMessage(lead.inboxMessage, businessName), index)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{copiedLead === index ? <Check size={14} /> : <Copy size={14} />}{copiedLead === index ? text.copied : text.copyInbox}</button>
                      {!isDemoMode && !!user && telegramBotActive && telegramBotUsername && (
                        <button onClick={() => void startBotChat(lead, index)} title={isKm ? 'ចម្លងតំណ Telegram Bot ដើម្បីផ្ញើទៅអតិថិជន' : 'Copies a Telegram bot link to send this lead'} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700">{chattingLeadIndex === index ? <Check size={14} /> : <MessageCircle size={14} />}{chattingLeadIndex === index ? text.copied : text.chatViaBot}</button>
                      )}
                      {!isDemoMode && !!user && lead.email && (
                        <button onClick={() => void sendLeadEmail(lead, index)} disabled={emailSendingIndex === index} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                          {emailSendingIndex === index ? <Loader2 size={14} className="animate-spin" /> : emailSentIndex === index ? <Check size={14} /> : <Mail size={14} />}
                          {emailSentIndex === index ? text.emailSent : text.sendEmail}
                        </button>
                      )}
                    </div>
                    {emailError?.index === index && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                        <AlertCircle className="mt-0.5 shrink-0" size={14} />{emailError.message}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/70 p-6 text-sm leading-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{text.noVerifiedLeads}</div>
            )}
          </section>

          {!!result.videoPlan.length && (
            <section>
              <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><CalendarDays className="text-violet-500" />{text.plan}</h3>
              <div className="space-y-4">
                {result.videoPlan.map((item, index) => (
                  <article key={`${item.date}-${index}`} className="glass grid gap-5 rounded-3xl p-5 lg:grid-cols-[150px_1fr_auto] lg:items-center">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-blue-500">{item.day}</p>
                      <p className="mt-1 font-black text-slate-800 dark:text-white">{item.date}</p>
                      <p className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-500"><Clock3 size={14} />{item.suggestedPostTime}</p>
                    </div>
                    <div>
                      <h4 className="font-black text-slate-800 dark:text-white">{item.topic}</h4>
                      <p className="mt-2 text-sm font-bold text-rose-500">“{item.hook}”</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.targetDesire}</p>
                      <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-300">🎙️ {item.voiceOverText}</p>
                    </div>
                    <button onClick={() => createVideo(item)} className="flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-violet-700"><Video size={17} />{text.create}</button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {result.summaryReport && (
            <section className="glass rounded-[2rem] p-6 md:p-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xl font-black text-slate-800 dark:text-white">{text.report}</h3>
                <button onClick={() => void copyReport()} className="flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-4 py-2 text-xs font-bold text-brand-700 dark:bg-slate-900 dark:text-brand-300">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? text.copied : text.copy}</button>
              </div>
              <div className="prose prose-brand max-w-none text-slate-700 dark:text-slate-200"><Markdown>{result.summaryReport}</Markdown></div>
            </section>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default FacebookScanner;
