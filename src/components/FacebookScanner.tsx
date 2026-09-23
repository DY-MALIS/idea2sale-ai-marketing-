import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { useAuth } from '../contexts/AuthContext';
import { ensureBusinessInInboxMessage, getLatestBusinessBranding } from '../lib/businessBranding';
import {
  AlertCircle,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
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
  TrendingUp,
  Users,
  Video,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { CreativeAutomationRequest, FacebookCompetitorInsight, FacebookPotentialLead, FacebookRecentActivity, FacebookScanResult, FacebookVideoPlanItem } from '../types';
import { deleteGenerationHistory, GenerationHistoryEntry, saveGenerationHistory, useGenerationHistory } from '../lib/generationHistory';
import HistoryPanel from './HistoryPanel';
import { downloadCsv } from '../lib/csvExport';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { normalizeFacebookScanHistoryResult } from '../lib/facebookScanHistory';
import { competitorActivityKey, summarizeCompetitorActivities } from '../lib/competitorActivity';

interface FacebookScannerProps {
  onCreativeAutomation: (request: CreativeAutomationRequest) => void;
}

type ScanMode = NonNullable<FacebookPotentialLead['opportunityType']>;

const countryOptions = [
  { code: 'KH', label: 'Cambodia' },
  { code: 'TH', label: 'Thailand' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'US', label: 'United States' },
];

const activityPlatform = (activity: FacebookRecentActivity): NonNullable<FacebookRecentActivity['platform']> => {
  if (activity.platform) return activity.platform;
  try {
    const host = new URL(activity.sourceUrl).hostname.toLowerCase();
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com') return 'Facebook';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok';
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LinkedIn';
  } catch {
    // Old history entries may contain an invalid or missing source URL.
  }
  return 'Web';
};

const activityPlatformClass = (platform: NonNullable<FacebookRecentActivity['platform']>) => ({
  Facebook: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  TikTok: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
  LinkedIn: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-200',
  Web: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
}[platform]);

// Always render one row per platform, even when a competitor has zero
// activity there -- a merged single-list view silently hides that a
// platform was checked at all, which read as "the scan skipped TikTok"
// even though the backend already searches all three for every competitor.
const ACTIVITY_PLATFORM_ORDER: NonNullable<FacebookRecentActivity['platform']>[] = ['Facebook', 'TikTok', 'LinkedIn'];

const FacebookScanner: React.FC<FacebookScannerProps> = ({ onCreativeAutomation }) => {
  const { language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const isKm = language === 'km';
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('KH');
  const [days, setDays] = useState(7);
  const [scanMode, setScanMode] = useState<ScanMode>('customer');
  // The scanner defaults to auto-detecting intent from the query text (see
  // scan() below) instead of forcing a manual category pick first. This only
  // flips true once the person actually touches a category/mode control, so
  // their explicit choice is respected instead of being silently overridden.
  const [modeExplicit, setModeExplicit] = useState(false);
  const [showModeOptions, setShowModeOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FacebookScanResult | null>(null);
  const [comparisonBaseline, setComparisonBaseline] = useState<FacebookScanResult | null>(null);
  const [showActivityReport, setShowActivityReport] = useState(false);
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
      ? ['ឈ្មោះ/ក្រុមហ៊ុន', 'ប្រភេទអ្នកផ្តល់សេវា', 'ជំនាញ/មុខរបរ', 'ប្រភេទអាជីវកម្ម', 'អាសយដ្ឋាន', 'ទូរស័ព្ទ', 'អ៊ីមែល', 'Telegram', 'គេហទំព័រ', 'Facebook Page', 'LinkedIn', 'ប្រភេទឱកាស', 'ពិន្ទុសក្តានុពល', 'កម្រិត Lead', 'សញ្ញាចាប់អារម្មណ៍', 'សញ្ញាចំណាយ', 'ប្រភេទការងារ', 'សញ្ញាជ្រើសបុគ្គលិក', 'សញ្ញាគូប្រកួត', 'សេវាកម្មដែលណែនាំ', 'សារ Inbox', 'ប្រភព']
      : ['Name / Company', 'Entity Kind', 'Trade / Work Type', 'Business Type', 'Address', 'Phone', 'Email', 'Telegram', 'Website', 'Facebook Page', 'LinkedIn', 'Opportunity Type', 'Fit Score', 'Lead Level', 'Interest Signals', 'Spending Signals', 'Job Types', 'Hiring Signals', 'Competitor Signals', 'Recommended Service', 'Inbox Message', 'Source URL'];
    const rows = selected.map((lead) => [
      lead.businessName,
      lead.entityKind || '',
      lead.serviceOrJobType || '',
      lead.businessType,
      lead.address || '',
      lead.phone || '',
      lead.email || '',
      lead.telegram || '',
      lead.website || '',
      lead.facebookUrl || lead.facebookPageName || '',
      lead.linkedinUrl || '',
      lead.opportunityType || '',
      lead.fitScore ?? '',
      lead.leadLevel,
      (lead.interestSignals || []).join(' | '),
      (lead.spendingSignals || []).join(' | '),
      (lead.jobTypes || []).join(' | '),
      (lead.hiringSignals || []).join(' | '),
      (lead.competitorSignals || []).join(' | '),
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

  const [savingLeadIndex, setSavingLeadIndex] = useState<number | null>(null);
  const [savedLeadIndex, setSavedLeadIndex] = useState<number | null>(null);
  const [saveLeadError, setSaveLeadError] = useState<{ index: number; message: string } | null>(null);
  const [savingCompetitorIndex, setSavingCompetitorIndex] = useState<number | null>(null);
  const [savedCompetitorIndex, setSavedCompetitorIndex] = useState<number | null>(null);
  const [saveCompetitorError, setSaveCompetitorError] = useState<{ index: number; message: string } | null>(null);

  // Customer prospects and competitors share one owner-scoped collection, with
  // recordType deciding which list they appear in on the organizer page.
  const saveScannedBusiness = async (lead: FacebookPotentialLead, index: number) => {
    if (!user || isDemoMode) return;
    const opportunityType = lead.opportunityType || result?.scanMode || scanMode;
    const recordType = ['competitor_activity', 'competitor_customers'].includes(opportunityType)
      ? 'competitor'
      : 'customer';
    setSavingLeadIndex(index);
    setSaveLeadError(null);
    try {
      await addDoc(collection(db, 'saved_leads'), {
        ownerId: user.uid,
        recordType,
        businessName: lead.businessName || '',
        entityKind: lead.entityKind || 'company',
        serviceOrJobType: lead.serviceOrJobType || '',
        businessType: lead.businessType || '',
        address: lead.address || '',
        phone: lead.phone || '',
        email: lead.email || '',
        telegram: lead.telegram || '',
        website: lead.website || '',
        facebookPageName: lead.facebookPageName || '',
        facebookPageUrl: lead.facebookUrl || '',
        linkedinUrl: lead.linkedinUrl || '',
        leadLevel: lead.leadLevel || '',
        opportunityType,
        fitScore: lead.fitScore || 0,
        interestSignals: lead.interestSignals || [],
        spendingSignals: lead.spendingSignals || [],
        jobTypes: lead.jobTypes || [],
        hiringSignals: lead.hiringSignals || [],
        competitorSignals: lead.competitorSignals || [],
        recentActivities: lead.recentActivities || [],
        recommendedService: lead.recommendedService || '',
        inboxMessage: recordType === 'competitor' ? '' : ensureBusinessInInboxMessage(lead.inboxMessage, businessName).slice(0, 1500),
        evidenceSourceUrl: lead.evidenceSourceUrl || '',
        createdAt: serverTimestamp(),
      });
      setSavedLeadIndex(index);
      window.setTimeout(() => setSavedLeadIndex((current) => (current === index ? null : current)), 2500);
    } catch (err: any) {
      setSaveLeadError({ index, message: err?.message || (isKm ? 'មិនអាចរក្សាទុកបានទេ។' : 'Could not save this lead.') });
    } finally {
      setSavingLeadIndex(null);
    }
  };

  const saveCompetitor = async (competitor: FacebookCompetitorInsight, index: number) => {
    if (!user || isDemoMode) return;
    setSavingCompetitorIndex(index);
    setSaveCompetitorError(null);
    try {
      await addDoc(collection(db, 'saved_leads'), {
        ownerId: user.uid,
        recordType: 'competitor',
        businessName: competitor.pageName || '',
        businessType: 'Competitor',
        address: '',
        phone: '',
        email: '',
        telegram: '',
        website: '',
        linkedinUrl: competitor.linkedinUrl || '',
        facebookPageName: competitor.pageName || '',
        facebookPageUrl: competitor.facebookUrl || '',
        tiktokUrl: competitor.tiktokUrl || '',
        leadLevel: '',
        matchReason: competitor.matchReason || '',
        topAngle: competitor.topAngle || '',
        offerStrategy: competitor.offerStrategy || '',
        weakness: competitor.weakness || '',
        counterStrategy: competitor.counterStrategy || '',
        publicActivitySignals: competitor.publicActivitySignals || [],
        recentActivities: competitor.recentActivities || [],
        activityWindow: result?.activityWindow || null,
        customerSegments: competitor.customerSegments || [],
        recommendedService: competitor.counterStrategy || '',
        inboxMessage: '',
        evidenceSourceUrl: competitor.sourceUrl || '',
        createdAt: serverTimestamp(),
      });
      setSavedCompetitorIndex(index);
      window.setTimeout(() => setSavedCompetitorIndex((current) => (current === index ? null : current)), 2500);
    } catch (err: any) {
      setSaveCompetitorError({ index, message: err?.message || (isKm ? 'មិនអាចរក្សាទុកដៃគូប្រកួតប្រជែងបានទេ។' : 'Could not save this competitor.') });
    } finally {
      setSavingCompetitorIndex(null);
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

  // A source-by-source report can be long. Keep each new/restored scan compact
  // until the person explicitly asks to inspect the detailed evidence.
  useEffect(() => {
    setShowActivityReport(false);
  }, [result]);

  const text = isKm ? {
    recentActivityTitle: 'សកម្មភាពក្នុង ៧ ថ្ងៃចុងក្រោយ',
    recentActivityThroughToday: 'រហូតដល់ថ្ងៃនេះ',
    noRecentActivity: 'មិនមានសកម្មភាពសាធារណៈដែលបានផ្ទៀងផ្ទាត់ក្នុងរយៈពេល ៧ ថ្ងៃនេះទេ។',
    noRecentActivityLastSeen: 'មិនមានសកម្មភាពក្នុង ៧ ថ្ងៃនេះទេ។ សកម្មភាពផ្សព្វផ្សាយជាសាធារណៈចុងក្រោយគេ៖',
    noRecentActivityForPlatform: 'មិនមានសកម្មភាពដែលបានផ្ទៀងផ្ទាត់នៅលើនេះក្នុងរយៈពេលនេះទេ។',
    marketTrendsTitle: 'រលកទីផ្សារ និង Content ក្នុង ៧ ថ្ងៃចុងក្រោយ',
    noMarketTrends: 'មិនមាន trend ដែលមានកាលបរិច្ឆេទ និងប្រភពអាចផ្ទៀងផ្ទាត់បានក្នុងរយៈពេលនេះទេ។',
    trendEvidence: 'ភស្តុតាងសាធារណៈ',
    trendOpportunity: 'ឱកាសសម្រាប់អាជីវកម្ម និងវីដេអូ',
    weeklyCaptureTitle: 'ការចាប់យកសកម្មភាពគូប្រកួតប្រចាំសប្ដាហ៍',
    weeklyCaptureBody: 'លទ្ធផលនេះត្រូវបានរក្សាទុកជា snapshot។ ស្កេនពាក្យដដែលម្ដងទៀតនៅសប្ដាហ៍ក្រោយ ដើម្បីឃើញសកម្មភាពថ្មីរបស់គូប្រកួត។',
    capturedActivities: 'សកម្មភាពដែលបានចាប់យក',
    dailyActivityReport: 'របាយការណ៍សកម្មភាពតាមប្រភព',
    noCapturedActivityReport: 'រកមិនឃើញ post, offer, ad ឬ campaign ដែលមានកាលបរិច្ឆេទ និងប្រភពច្បាស់ក្នុងរយៈពេល ៧ ថ្ងៃនេះទេ។',
    contentSummary: 'ខ្លឹមសារសង្ខេប',
    verifiedDetails: 'ព័ត៌មានលម្អិតពីប្រភព',
    websiteSource: 'Website',
    newSincePrevious: 'សកម្មភាពថ្មីពីការចាប់យកមុន',
    firstCapture: 'នេះជាការចាប់យកលើកដំបូង',
    exportActivityReport: 'ទាញយករបាយការណ៍សកម្មភាព',
    sourceCoverage: 'ប្រភពដែលបានចាប់យក',
    newActivity: 'ថ្មី',
    eyebrow: 'Facebook Audience Intelligence',
    title: 'ស្គេនអតិថិជន និងគូប្រជែង',
    subtitle: 'វិភាគតម្រូវការ ចំណង់ចំណូលចិត្ត គូប្រជែង និងបង្កើតកាលវិភាគវីដេអូដោយ AI។',
    sourceTitle: 'ទិន្នន័យមានសុវត្ថិភាព និងគោរពឯកជនភាព',
    sourceBody: 'ប្រើតែប្រភព web សាធារណៈ និងតំណភស្តុតាងដែលអាចផ្ទៀងផ្ទាត់បាន។ វាមិនចូលមើល profile ឯកជន សារ ឬពាក្យសម្ងាត់អតិថិជនទេ។',
    query: 'ស្វែងរកអតិថិជន ប្រភេទអាជីវកម្ម ក្រុមហ៊ុន ទីផ្សារ ឬគូប្រជែង',
    placeholder: 'ឧ. ភោជនីយដ្ឋានភ្នំពេញ, គ្លីនិកកម្ពុជា, ឈ្មោះក្រុមហ៊ុន, អាជីវកម្មត្រូវការ Content...',
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
    saveToCrm: 'រក្សាទុកជាអតិថិជន',
    savedToCrm: 'បានរក្សាទុក!',
    saveCompetitor: 'រក្សាទុកជាដៃគូប្រកួតប្រជែង',
    savedCompetitor: 'បានរក្សាទុក!',
    noVerifiedLeads: 'មិនទាន់មាន Lead ដែលបានផ្ទៀងផ្ទាត់ទេ។ សូមសាកល្បងស្គេនម្តងទៀត ដើម្បីទទួលបានឈ្មោះអាជីវកម្មពិត។',
    noVerifiedCompetitors: 'ការស្វែងរកលើវេបផ្ទាល់មិនរកឃើញឈ្មោះគូប្រកួតប្រជែងពិតដែលអាចផ្ទៀងផ្ទាត់បានទេ។ ប្រព័ន្ធនឹងមិនស្មានឈ្មោះឡើយ។',
    researchTarget: 'គោលដៅស្រាវជ្រាវ',
    needSignals: 'សញ្ញាថាត្រូវការ Content/Video',
    recommendedService: 'សេវាកម្មដែលគួរផ្តល់ជូន',
    publicContact: 'ព័ត៌មានទំនាក់ទំនងសាធារណៈ',
    viewPage: 'បើក Facebook Page',
    viewEvidence: 'មើលភស្តុតាងសាធារណៈ',
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
    socialSearchConnected: 'ស្វែងរកតាម Web សាធារណៈ៖ Facebook + TikTok + LinkedIn',
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
    scanType: 'ជ្រើសគោលដៅស្គេន',
    customerCategory: 'ស្វែងរកអតិថិជន',
    customerCategoryDesc: 'ស្វែងរកតាមឈ្មោះ ប្រភេទអតិថិជន ក្រុមហ៊ុន វិស័យ ទីតាំង ឬតម្រូវការ',
    competitorCategory: 'វិភាគដៃគូប្រកួតប្រជែង',
    competitorCategoryDesc: 'រកដៃគូប្រកួតប្រជែង ហើយបង្ហាញក្រុមអតិថិជន និងសកម្មភាព ៧ ថ្ងៃរួមគ្នា',
    autoModeHint: 'គ្រាន់តែវាយអ្វីដែលអ្នកកំពុងស្វែងរក — AI នឹងកំណត់ប្រភេទសមស្របដោយខ្លួនឯង (អតិថិជន, គូប្រកួត, និន្នាការទីផ្សារ, ការជ្រើសរើសបុគ្គលិក និងជម្រើសផ្សេងទៀត)។',
    manualModeToggleShow: 'កំណត់ប្រភេទស្វែងរកដោយដៃ (ស្រេចចិត្ត)',
    manualModeToggleHide: 'លាក់ជម្រើសកំណត់ដោយដៃ',
    score: 'ពិន្ទុសក្តានុពល',
    interestSignals: 'សញ្ញាចាប់អារម្មណ៍ AI/សេវាកម្ម',
    spendingSignals: 'សញ្ញាសមត្ថភាពចំណាយ (ការប៉ាន់ស្មាន)',
    hiringSignals: 'សញ្ញាជ្រើសរើសបុគ្គលិក',
    jobTypes: 'ប្រភេទការងារ / មុខតំណែង',
    tradeType: 'ជំនាញ / មុខរបរ',
    competitorSignals: 'សកម្មភាពគូប្រកួត',
    customerSegments: 'ក្រុមអតិថិជនរបស់គូប្រកួត',
    publicActivity: 'សកម្មភាពសាធារណៈដែលរកឃើញ',
    privacyScope: 'ស្គេនតែអាជីវកម្ម Page ផ្សាយពាណិជ្ជកម្ម និងសញ្ញាសាធារណៈ។ មិនចូលមើល profile ឯកជន សារ ឬទិន្នន័យហិរញ្ញវត្ថុផ្ទាល់ខ្លួនទេ។',
    modeOptions: [
      { id: 'customer', label: 'ស្វែងរកអតិថិជន', description: 'រកតាមឈ្មោះ ប្រភេទអតិថិជន ក្រុមហ៊ុន វិស័យ ទីតាំង ឬតម្រូវការ', suggestions: ['អាជីវកម្មត្រូវការ Content', 'ភោជនីយដ្ឋានភ្នំពេញ', 'គ្លីនិកកម្ពុជា', 'ក្រុមហ៊ុនសំណង់សៀមរាប', 'ឈ្មោះក្រុមហ៊ុនជាក់លាក់'] },
      { id: 'ai_interest', label: 'អ្នកចាប់អារម្មណ៍ AI', description: 'រកអាជីវកម្មដែលមានភាពសមស្របនឹង AI និង automation', suggestions: ['អាជីវកម្មចាប់អារម្មណ៍ AI', 'ក្រុមហ៊ុន digital transformation', 'សាលាបណ្តុះបណ្តាល AI'] },
      { id: 'market_trends', label: 'ស្វែងរករលកទីផ្សារ', description: 'រក trend តម្រូវការ និង Content ដែលកំពុងកើនឡើងក្នុង ៧ ថ្ងៃ ដោយមានប្រភព', suggestions: ['trend AI កម្ពុជា', 'trend អាហារ និងភេសជ្ជៈ', 'trend skincare Cambodia', 'Content កំពុងពេញនិយម'] },
      { id: 'high_value', label: 'អ្នកមានសក្តានុពលចំណាយ', description: 'វាយតម្លៃពី premium positioning និងសកម្មភាពផ្សាយពាណិជ្ជកម្មសាធារណៈ', suggestions: ['អចលនទ្រព្យ premium', 'គ្លីនិកសម្ផស្ស', 'សណ្ឋាគារ និង resort'] },
      { id: 'construction', label: 'ម៉ៅការសំណង់', description: 'រកម៉ៅការ developer និងអ្នកផ្គត់ផ្គង់សំណង់', suggestions: ['ម៉ៅការសំណង់កម្ពុជា', 'Property developer Phnom Penh', 'អ្នកផ្គត់ផ្គង់សម្ភារៈសំណង់'] },
      { id: 'workers', label: 'ស្វែងរកជាង និងអ្នករកការងារ', description: 'រកអ្នកផ្តល់សេវា ក្រុមជាង freelancer និងអ្នកប្រកាសរកការងារតាមជំនាញ', suggestions: ['ជាងសង់ផ្ទះភ្នំពេញ', 'ជាងលាបថ្នាំកម្ពុជា', 'ជាងភ្លើងកំពុងរកការងារ', 'ជាងទឹកសៀមរាប', 'ក្រុមម៉ៅការសំណង់'] },
      { id: 'competitor_activity', label: 'ដៃគូប្រកួតប្រជែង + សកម្មភាព ៧ ថ្ងៃ', description: 'រកដៃគូប្រកួតប្រជែងម្តង ហើយបង្ហាញក្រុមអតិថិជន buying triggers និងសកម្មភាព ៧ ថ្ងៃដែលមានប្រភពច្បាស់រួមគ្នា', suggestions: ['ឈ្មោះ Page គូប្រកួត', 'គូប្រកួត skincare Cambodia', 'គូប្រកួតអចលនទ្រព្យ'] },
      { id: 'hiring', label: 'ក្រុមហ៊ុនកំពុងរើសបុគ្គលិក', description: 'រកឈ្មោះក្រុមហ៊ុនដែលមានប្រកាសជ្រើសរើសថ្មីៗ និង link ភស្តុតាង', suggestions: ['ក្រុមហ៊ុនកំពុងរើសបុគ្គលិកកម្ពុជា', 'ក្រុមហ៊ុនរើស Sales', 'គ្លីនិករើសបុគ្គលិក', 'ការងារ Digital Marketing Cambodia', 'ក្រុមហ៊ុនរើស Marketing Manager'] },
    ],
    suggestions: [
      'ហាងសម្លៀកបំពាក់នារី',
      'Skincare Cambodia',
      'ភោជនីយដ្ឋានកម្ពុជា',
      'សេវាកម្មសម្ផស្ស និង Spa',
      'អចលនទ្រព្យ ភ្នំពេញ',
    ],
  } : {
    recentActivityTitle: 'Activity in the last 7 days',
    recentActivityThroughToday: 'through today',
    noRecentActivity: 'No verified public activity was found in this 7-day period.',
    noRecentActivityForPlatform: 'No verified activity found here in this period.',
    noRecentActivityLastSeen: 'No activity in the last 7 days. Last verified public activity:',
    marketTrendsTitle: 'Market and content waves in the last 7 days',
    noMarketTrends: 'No dated, source-verifiable trend was found in this period.',
    trendEvidence: 'Public evidence',
    trendOpportunity: 'Business and video opportunity',
    weeklyCaptureTitle: 'Weekly competitor activity capture',
    weeklyCaptureBody: 'This result is saved as a snapshot. Scan the same query again next week to see newly captured competitor activity.',
    capturedActivities: 'Captured activities',
    dailyActivityReport: 'Activity report by source',
    noCapturedActivityReport: 'No dated post, offer, ad, or campaign with a verifiable source was found in this 7-day period.',
    contentSummary: 'Content summary',
    verifiedDetails: 'Source-backed details',
    websiteSource: 'Website',
    newSincePrevious: 'New since the previous capture',
    firstCapture: 'This is the first capture',
    exportActivityReport: 'Download activity report',
    sourceCoverage: 'Captured by source',
    newActivity: 'New',
    eyebrow: 'Facebook Audience Intelligence',
    title: 'Customer & competitor scanner',
    subtitle: 'Understand demand, preferences and competitors, then turn the findings into an AI video calendar.',
    sourceTitle: 'Privacy-safe research',
    sourceBody: 'Uses public web sources with verifiable evidence links. It never reads private profiles, messages, or customer passwords.',
    query: 'Search customers, business types, companies, markets, or competitors',
    placeholder: 'e.g. Phnom Penh restaurants, Cambodia clinics, company name, businesses needing content…',
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
    saveToCrm: 'Save as customer',
    savedToCrm: 'Saved!',
    saveCompetitor: 'Save as competitor',
    savedCompetitor: 'Saved!',
    noVerifiedLeads: 'No verified leads yet. Try scanning again to receive real business names.',
    noVerifiedCompetitors: 'Live web search found no real, verifiable competitor names. The system will not guess any.',
    researchTarget: 'Research target',
    needSignals: 'Signals they may need content/video',
    recommendedService: 'Recommended service',
    publicContact: 'Public contact',
    viewPage: 'Open Facebook Page',
    viewEvidence: 'View public evidence',
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
    socialSearchConnected: 'Public-web search: Facebook + TikTok + LinkedIn',
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
    scanType: 'Choose a scan target',
    customerCategory: 'Find customers',
    customerCategoryDesc: 'Search by name, customer type, company, industry, location, or need',
    competitorCategory: 'Research competitors',
    competitorCategoryDesc: 'Find competitors and show their customer segments and verified 7-day activity together',
    autoModeHint: "Just type what you're looking for — AI figures out the right search type automatically (customers, competitors, market trends, hiring, and more).",
    manualModeToggleShow: 'Choose a search type manually (optional)',
    manualModeToggleHide: 'Hide manual options',
    score: 'Opportunity score',
    interestSignals: 'AI/service interest signals',
    spendingSignals: 'Estimated spending-potential signals',
    hiringSignals: 'Public hiring signals',
    jobTypes: 'Job types / positions',
    tradeType: 'Trade / work type',
    competitorSignals: 'Competitor activity signals',
    customerSegments: 'Competitor customer segments',
    publicActivity: 'Verified public activity',
    privacyScope: 'Scans only public businesses, Pages, ads and public signals. It never reads private profiles, messages or personal financial data.',
    modeOptions: [
      { id: 'customer', label: 'Find customers', description: 'Search by name, customer type, company, industry, location, or need', suggestions: ['businesses needing content', 'Phnom Penh restaurants', 'Cambodia clinics', 'Siem Reap construction companies', 'specific company name'] },
      { id: 'ai_interest', label: 'AI-interested prospects', description: 'Find businesses that fit AI and automation services', suggestions: ['businesses interested in AI', 'digital transformation companies', 'AI training businesses'] },
      { id: 'market_trends', label: 'Find market waves', description: 'Find sourced trends in demand and content rising during the last 7 days', suggestions: ['Cambodia AI trends', 'food and beverage trends', 'skincare trends Cambodia', 'trending content formats'] },
      { id: 'high_value', label: 'High-value prospects', description: 'Estimate potential from premium positioning and public ad activity', suggestions: ['premium real estate', 'aesthetic clinics', 'hotels and resorts'] },
      { id: 'construction', label: 'Construction contractors', description: 'Find contractors, developers and construction suppliers', suggestions: ['Cambodia construction contractors', 'Phnom Penh property developers', 'construction material suppliers'] },
      { id: 'workers', label: 'Find workers & job seekers', description: 'Find public service providers, trade teams, freelancers, and people publicly seeking work by skill', suggestions: ['house builders Phnom Penh', 'painters Cambodia', 'electricians seeking work', 'plumbers Siem Reap', 'construction contractor teams'] },
      { id: 'competitor_activity', label: 'Competitors + 7-day activity', description: 'Find each competitor once, then show its customer segments, buying triggers, and dated public activity with evidence links together', suggestions: ['competitor Page name', 'skincare competitors Cambodia', 'real estate competitors'] },
      { id: 'hiring', label: 'Companies hiring staff', description: 'Find named employers with recent public job posts and evidence links', suggestions: ['companies hiring staff Cambodia', 'companies hiring sales Cambodia', 'clinics hiring staff', 'digital marketing jobs Cambodia', 'hiring marketing manager'] },
    ],
    suggestions: [
      "Women's fashion shop",
      'Skincare Cambodia',
      'Cambodia restaurant',
      'Beauty salon & spa services',
      'Real estate Phnom Penh',
    ],
  };

  const scanModes = text.modeOptions as Array<{
    id: ScanMode;
    label: string;
    description: string;
    suggestions: string[];
  }>;
  const activeScanMode = scanModes.find((mode) => mode.id === scanMode) || scanModes[0];
  // Keep the old id only for rendering previously saved history. New searches
  // expose one competitor mode and the server normalizes the legacy id.
  const competitorModeIds: ScanMode[] = ['competitor_activity', 'competitor_customers'];
  const resultIsCompetitorScan = competitorModeIds.includes(result?.scanMode || scanMode);
  const resultIsActivityScan = (result?.scanMode || scanMode) === 'competitor_activity';
  const resultIsTrendScan = (result?.scanMode || scanMode) === 'market_trends';
  // The user's selected scan category is authoritative for the whole result.
  // An AI-generated per-row opportunityType can occasionally be mislabeled;
  // using it here hid customer-only actions such as Chat via Bot from a real
  // customer scan. Competitor scans still hide those actions as requested.
  const isCompetitorLead = (_lead: FacebookPotentialLead) => resultIsCompetitorScan;
  const scanCategory = competitorModeIds.includes(scanMode) ? 'competitor' : 'customer';
  const visibleScanModes = scanModes.filter((mode) => (
    scanCategory === 'competitor'
      ? mode.id === 'competitor_activity'
      : !competitorModeIds.includes(mode.id)
  ));

  const selectScanCategory = (category: 'customer' | 'competitor') => {
    setScanMode(category === 'competitor' ? 'competitor_activity' : 'customer');
    setModeExplicit(true);
    setResult(null);
    setComparisonBaseline(null);
    setError('');
  };

  const selectScanMode = (mode: ScanMode) => {
    setScanMode(mode);
    setModeExplicit(true);
    setResult(null);
    setComparisonBaseline(null);
    setError('');
  };

  const scanHistory = useGenerationHistory(user, isDemoMode, 'facebook_scan');

  const findPreviousCompetitorCapture = (
    targetQuery: string,
    targetCountry: string,
    beforeCreatedAt = Number.POSITIVE_INFINITY,
  ): FacebookScanResult | null => {
    const normalizedQuery = targetQuery.trim().toLocaleLowerCase();
    for (const entry of scanHistory) {
      if (entry.createdAt >= beforeCreatedAt) continue;
      const payload = (entry.payload || {}) as Record<string, unknown>;
      if (String(payload.scanMode || '') !== 'competitor_activity') continue;
      if (String(payload.country || '') !== targetCountry) continue;
      if (String(payload.query || '').trim().toLocaleLowerCase() !== normalizedQuery) continue;
      const restored = normalizeFacebookScanHistoryResult(payload.result as Partial<FacebookScanResult> | undefined);
      if (restored) return restored;
    }
    return null;
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
          // Only send an explicit category the person actually picked -- by
          // default the server infers the right search type from the query
          // text itself, so nothing has to be pre-selected before scanning.
          scanMode: modeExplicit ? scanMode : 'auto',
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
      // The server resolves 'auto' into a concrete mode and returns it on the
      // result -- prefer that over local state, which may still say the
      // default ('customer') when nothing was manually picked.
      const resolvedMode = (data?.scanMode as ScanMode) || scanMode;
      setComparisonBaseline(resolvedMode === 'competitor_activity'
        ? findPreviousCompetitorCapture(cleanQuery, country)
        : null);
      setDeselectedLeads(new Set());
      const leadCount = Array.isArray(data.potentialLeads) ? data.potentialLeads.length : 0;
      const activityCount = Array.isArray(data.competitors)
        ? data.competitors.reduce((total: number, competitor: FacebookCompetitorInsight) => total + (competitor.recentActivities?.length || 0), 0)
        : 0;
      void saveGenerationHistory({
        user, isDemoMode, type: 'facebook_scan',
        title: cleanQuery,
        summary: resolvedMode === 'competitor_activity'
          ? (isKm ? `ចាប់យកបាន ${activityCount} សកម្មភាពក្នុង ៧ ថ្ងៃ` : `${activityCount} competitor activit${activityCount === 1 ? 'y' : 'ies'} captured in 7 days`)
          : (isKm ? `Lead ចំនួន ${leadCount}` : `${leadCount} lead${leadCount === 1 ? '' : 's'} found`),
        payload: { query: cleanQuery, country, days, scanMode: resolvedMode, result: data },
      }).catch((historyError) => console.error('Failed to save scan history:', historyError));
    } catch (scanError: any) {
      setError(scanError?.message || (isKm ? 'មិនអាចវិភាគបានទេ។ សូមព្យាយាមម្តងទៀត។' : 'The scan failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  // Normalizes every field defensively instead of trusting the saved shape
  // as-is: an entry saved by an earlier version of this schema (before a field
  // like targetPersonas existed, for example) would otherwise pass `undefined`
  // into `result`, and the render below calls `.length`/`.map` on these arrays
  // unconditionally -- that throws and the restore silently does nothing
  // visible instead of showing the entry.
  const restoreScanHistory = (entry: GenerationHistoryEntry) => {
    try {
      const payload = (entry.payload || {}) as Record<string, unknown>;
      if (typeof payload.query === 'string') setQuery(payload.query);
      if (typeof payload.country === 'string') setCountry(payload.country);
      if (typeof payload.days === 'number') setDays(payload.days);
      const restoredMode = payload.scanMode === 'competitor_customers' ? 'competitor_activity' : payload.scanMode;
      if (typeof restoredMode === 'string' && text.modeOptions.some((option) => option.id === restoredMode)) {
        setScanMode(restoredMode as ScanMode);
        setModeExplicit(true);
      }
      const raw = payload.result as Partial<FacebookScanResult> | undefined;
      const normalized = normalizeFacebookScanHistoryResult(raw);
      if (normalized) {
        setResult(normalized);
        setComparisonBaseline(normalized.scanMode === 'competitor_activity'
          ? findPreviousCompetitorCapture(
              typeof payload.query === 'string' ? payload.query : normalized.query,
              typeof payload.country === 'string' ? payload.country : country,
              entry.createdAt,
            )
          : null);
      }
      setDeselectedLeads(new Set());
    } catch (err) {
      console.error('Failed to restore scan history entry:', err);
      setError(isKm
        ? 'មិនអាចមើលប្រវត្តិនេះឡើងវិញបានទេ។ ទិន្នន័យអាចមិនត្រឹមត្រូវ។'
        : 'Could not restore this history entry -- its saved data may be incomplete.');
    }
  };
  const deleteScanHistory = (id: string) => { void deleteGenerationHistory({ user, isDemoMode, type: 'facebook_scan', id }); };

  const createVideo = (item: FacebookVideoPlanItem) => {
    onCreativeAutomation({
      id: `facebook-scan-${Date.now()}-${item.date}`,
      kind: 'video',
      prompt: `${item.prompt}\n\nPerformance direction: ${item.performanceStyle}\nHook: ${item.hook}`,
      platform: 'Facebook',
      aspectRatio: '16:9',
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

  const signalGroupsForLead = (lead: FacebookPotentialLead) => [
    { label: text.jobTypes, items: lead.jobTypes, tone: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200' },
    { label: text.interestSignals, items: lead.interestSignals, tone: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200' },
    { label: text.spendingSignals, items: lead.spendingSignals, tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200' },
    { label: text.hiringSignals, items: lead.hiringSignals, tone: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200' },
    { label: text.competitorSignals, items: lead.competitorSignals, tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200' },
  ].filter((group) => group.items?.length);

  const hasLeadSignals = (lead: FacebookPotentialLead) => (
    Boolean(lead.needSignals?.length) || signalGroupsForLead(lead).length > 0
  );

  const insightCards = result ? [
    { title: text.bought, icon: ShoppingBag, items: result.customerInsights.whatTheyBought, iconClass: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300' },
    { title: text.likes, icon: Heart, items: result.customerInsights.whatTheyLike, iconClass: 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300' },
    { title: text.content, icon: Video, items: result.customerInsights.contentDesires, iconClass: 'bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300' },
  ] : [];

  const capturedActivitySummary = resultIsActivityScan
    ? summarizeCompetitorActivities(result, comparisonBaseline)
    : null;
  const activityPlatformCounts = (result?.competitors || []).flatMap((competitor) => competitor.recentActivities || [])
    .reduce<Record<NonNullable<FacebookRecentActivity['platform']>, number>>((counts, activity) => {
      counts[activityPlatform(activity)] += 1;
      return counts;
    }, { Facebook: 0, TikTok: 0, LinkedIn: 0, Web: 0 });
  // Keep every source in one chronological activity stream. Platform is a
  // badge on each item, not a separate report or storage destination, so
  // Facebook and TikTok appear in exactly the same place as LinkedIn.
  const activityReportEntries = (result?.competitors || []).flatMap((competitor) => (
    (competitor.recentActivities || []).map((activity) => ({
      competitorName: competitor.pageName,
      activity,
    }))
  )).sort((left, right) => right.activity.date.localeCompare(left.activity.date));

  const exportCompetitorActivities = () => {
    if (!result || !capturedActivitySummary) return;
    const headers = isKm
      ? ['គូប្រកួត', 'កាលបរិច្ឆេទ', 'Platform', 'ប្រភេទ Content', 'ចំណងជើង', 'សកម្មភាព', 'ខ្លឹមសារសង្ខេប', 'ព័ត៌មានលម្អិត', 'ថ្មីពីការចាប់យកមុន', 'ប្រភព', 'ចាប់ពីថ្ងៃ', 'ដល់ថ្ងៃ']
      : ['Competitor', 'Date', 'Platform', 'Content type', 'Title', 'Activity', 'Content summary', 'Source-backed details', 'New since previous capture', 'Source URL', 'Window start', 'Window end'];
    const rows = result.competitors.flatMap((competitor) => (
      (competitor.recentActivities || []).map((activity) => [
        competitor.pageName,
        activity.date,
        activityPlatform(activity),
        activity.contentType || '',
        activity.title || '',
        activity.activity,
        activity.summary || '',
        (activity.keyDetails || []).join(' | '),
        capturedActivitySummary.newActivityKeys.has(competitorActivityKey(competitor.pageName, activity)) ? 'Yes' : 'No',
        activity.sourceUrl,
        result.activityWindow?.startDate || '',
        result.activityWindow?.endDate || '',
      ])
    ));
    if (!rows.length) return;
    const safeQuery = result.query.trim().slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-') || 'competitor-activity';
    downloadCsv(`${safeQuery}-weekly-activity-${result.activityWindow?.endDate || new Date().toISOString().slice(0, 10)}.csv`, [headers, ...rows]);
  };

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
        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.scanType}</h3>
            <span className="max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">{text.privacyScope}</span>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-100 bg-white/55 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex items-center gap-2">
              <Sparkles className="shrink-0 text-brand-500" size={18} />
              <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                {modeExplicit ? activeScanMode.description : text.autoModeHint}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowModeOptions((prev) => !prev)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
            >
              {showModeOptions ? text.manualModeToggleHide : text.manualModeToggleShow}
              <ChevronDown size={14} className={`transition-transform ${showModeOptions ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {showModeOptions && (
          <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => selectScanCategory('customer')}
              className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${scanCategory === 'customer'
                ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20 dark:bg-emerald-950/40'
                : 'border-brand-100 bg-white/60 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900/50'}`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"><Users size={22} /></span>
              <span><span className="block font-black text-slate-800 dark:text-white">{text.customerCategory}</span><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{text.customerCategoryDesc}</span></span>
            </button>
            <button
              type="button"
              onClick={() => selectScanCategory('competitor')}
              className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${scanCategory === 'competitor'
                ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20 dark:bg-indigo-950/40'
                : 'border-brand-100 bg-white/60 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900/50'}`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300"><Building2 size={22} /></span>
              <span><span className="block font-black text-slate-800 dark:text-white">{text.competitorCategory}</span><span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{text.competitorCategoryDesc}</span></span>
            </button>
          </div>
          <div className="rounded-2xl border border-brand-100 bg-white/55 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {visibleScanModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => selectScanMode(mode.id)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition ${scanMode === mode.id
                    ? scanCategory === 'competitor'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-brand-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="mt-2 px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{activeScanMode.description}</p>
          </div>
          </>
          )}
        </div>
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
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1">
              <span className="shrink-0 text-xs font-medium text-slate-400">{text.tryAsking}</span>
              {activeScanMode.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuery(suggestion)}
                  className="shrink-0 rounded-full border border-brand-200 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 dark:border-brand-800 dark:bg-slate-900/60 dark:text-brand-300 dark:hover:bg-slate-800"
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
              {result.webSearchAvailable ? (resultIsCompetitorScan ? text.socialSearchConnected : text.live) : text.estimated}
            </span>
            {!!result.webSearchAvailable && <span className="rounded-full bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{resultIsCompetitorScan ? result.competitors.length : (result.potentialLeads?.length || 0)} {resultIsCompetitorScan ? text.competitors : text.webBusinesses}</span>}
            {resultIsCompetitorScan && result.researchTarget && (
              <span className="rounded-full bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                {text.researchTarget}: {result.researchTarget}
              </span>
            )}
          </div>

          {!resultIsCompetitorScan && <div className="grid gap-5 xl:grid-cols-3">
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
          </div>}

          {resultIsTrendScan && (
            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white">
                  <TrendingUp className="text-fuchsia-500" />{text.marketTrendsTitle}
                </h3>
                <span className="text-xs font-bold text-fuchsia-600 dark:text-fuchsia-300">
                  {result.activityWindow?.startDate || ''}{result.activityWindow ? ' – ' : ''}{result.activityWindow?.endDate || ''}
                </span>
              </div>
              {result.marketTrends?.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {result.marketTrends.map((trend, index) => (
                    <article key={`${trend.sourceUrl}-${index}`} className="glass rounded-3xl border border-fuchsia-100 p-5 dark:border-fuchsia-950">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="font-black text-slate-800 dark:text-white">{trend.topic}</h4>
                        <span className="shrink-0 rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-bold text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">{trend.date}</span>
                      </div>
                      <p className="mt-4 text-xs font-black uppercase tracking-wider text-slate-400">{text.trendEvidence}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{trend.evidence}</p>
                      <div className="mt-4 rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
                        <p className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">{text.trendOpportunity}</p>
                        <p className="mt-1 text-sm leading-6 text-emerald-900 dark:text-emerald-100">{trend.opportunity}</p>
                      </div>
                      <a href={trend.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                        <ExternalLink size={13} />{text.viewEvidence}
                      </a>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-fuchsia-200 bg-fuchsia-50/60 p-6 text-sm text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/20 dark:text-fuchsia-200">{text.noMarketTrends}</div>
              )}
            </section>
          )}

          {!resultIsCompetitorScan && !!result.customerInsights.targetPersonas.length && (
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

          {resultIsCompetitorScan && capturedActivitySummary && (
            <section className="glass rounded-3xl border border-indigo-200 p-6 dark:border-indigo-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white">
                    <Radar className="text-indigo-500" />{text.weeklyCaptureTitle}
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{text.weeklyCaptureBody}</p>
                  <p className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-300">
                    {result.activityWindow?.startDate || ''}{result.activityWindow ? ' – ' : ''}{result.activityWindow?.endDate || text.recentActivityThroughToday}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportCompetitorActivities}
                  disabled={!capturedActivitySummary.totalCount}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FileSpreadsheet size={16} />{text.exportActivityReport}
                </button>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-950/40">
                  <p className="text-xs font-black uppercase tracking-wider text-indigo-500">{text.capturedActivities}</p>
                  <p className="mt-1 text-3xl font-black text-indigo-800 dark:text-indigo-200">{capturedActivitySummary.totalCount}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/40">
                  <p className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-300">
                    {capturedActivitySummary.hasPreviousCapture ? text.newSincePrevious : text.firstCapture}
                  </p>
                  <p className="mt-1 text-3xl font-black text-emerald-800 dark:text-emerald-200">
                    {capturedActivitySummary.hasPreviousCapture ? capturedActivitySummary.newCount : capturedActivitySummary.totalCount}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">{text.sourceCoverage}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(['Facebook', 'TikTok', 'LinkedIn', 'Web'] as const).map((platform) => (
                    <div key={platform} className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs font-black ${activityPlatformClass(platform)}`}>
                      <span>{platform === 'Web' ? text.websiteSource : platform}</span>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-sm text-slate-800 dark:bg-black/20 dark:text-inherit">{activityPlatformCounts[platform]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 border-t border-indigo-100 pt-5 dark:border-indigo-900">
                <button
                  type="button"
                  onClick={() => setShowActivityReport((visible) => !visible)}
                  aria-expanded={showActivityReport}
                  aria-controls="activity-report"
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/40"
                >
                  <span className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                    <CalendarDays size={17} />{text.dailyActivityReport}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-black text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
                      {capturedActivitySummary.totalCount}
                    </span>
                    <ChevronDown
                      size={19}
                      aria-hidden="true"
                      className={`text-indigo-600 transition-transform duration-200 dark:text-indigo-300 ${showActivityReport ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>
                {showActivityReport && (
                  <div id="activity-report">
                    {activityReportEntries.length ? (
                      <article className="mt-4 overflow-hidden rounded-2xl border border-indigo-100 bg-white/70 dark:border-indigo-900 dark:bg-slate-900/50">
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                          {activityReportEntries.map(({ competitorName, activity }, index) => {
                            const platform = activityPlatform(activity);
                            return (
                              <li key={`${competitorName}-${activity.sourceUrl}-${index}`} className="p-5 text-sm leading-6">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-md px-2 py-0.5 text-xs font-black ${activityPlatformClass(platform)}`}>
                                    {platform === 'Web' ? text.websiteSource : platform}
                                  </span>
                                  <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-black text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">{activity.date}</span>
                                  {activity.contentType && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{activity.contentType}</span>}
                                  <span className="font-black text-slate-800 dark:text-white">{competitorName}</span>
                                </div>
                                <h5 className="mt-3 font-black text-slate-800 dark:text-white">{activity.title || activity.activity}</h5>
                                {activity.title && activity.activity !== activity.title && <p className="mt-1 text-slate-600 dark:text-slate-300">{activity.activity}</p>}
                                {activity.summary && (
                                  <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">{text.contentSummary}</p>
                                    <p className="mt-1 text-slate-700 dark:text-slate-200">{activity.summary}</p>
                                  </div>
                                )}
                                {!!activity.keyDetails?.length && (
                                  <div className="mt-3">
                                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">{text.verifiedDetails}</p>
                                    <ul className="mt-2 space-y-1.5">
                                      {activity.keyDetails.map((detail, detailIndex) => (
                                        <li key={detailIndex} className="flex gap-2 text-slate-600 dark:text-slate-300"><Check className="mt-1 shrink-0 text-emerald-500" size={14} /><span>{detail}</span></li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <a href={activity.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                                  <ExternalLink size={12} />{text.viewEvidence}
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      </article>
                    ) : (
                      <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">{text.noCapturedActivityReport}</p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {resultIsCompetitorScan && <section>
            <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><BarChart3 className="text-indigo-500" />{text.competitors}</h3>
            {result.competitors.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {result.competitors.map((competitor, index) => (
                  <article key={`${competitor.pageName}-${index}`} className="glass rounded-3xl p-6">
                    <div className="mb-4 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-black text-white">{index + 1}</span><h4 className="text-lg font-black text-slate-800 dark:text-white">{competitor.pageName}</h4></div>
                    <dl className="grid gap-3 text-sm">
                      {competitor.matchReason && <div><dt className="font-bold text-indigo-500">{isKm ? 'ហេតុអ្វីជាគូប្រកួត' : 'Why this is a competitor'}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.matchReason}</dd></div>}
                      <div><dt className="font-bold text-slate-400">{text.angle}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.topAngle}</dd></div>
                      <div><dt className="font-bold text-slate-400">{text.offer}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.offerStrategy}</dd></div>
                      <div><dt className="font-bold text-rose-500">{text.weakness}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.weakness}</dd></div>
                      <div className="rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-950/30"><dt className="font-bold text-emerald-700 dark:text-emerald-300">{text.counter}</dt><dd className="mt-1 text-emerald-800 dark:text-emerald-100">{competitor.counterStrategy}</dd></div>
                      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <dt className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                            <CalendarDays size={15} />{text.recentActivityTitle}
                          </dt>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {result.activityWindow?.startDate || ''}{result.activityWindow ? ' – ' : ''}{result.activityWindow?.endDate || text.recentActivityThroughToday}
                          </span>
                        </div>
                        <dd className="mt-3 space-y-4">
                          {ACTIVITY_PLATFORM_ORDER.map((platform) => {
                            const platformActivities = (competitor.recentActivities || []).filter((activity) => activityPlatform(activity) === platform);
                            const platformLastKnown = !platformActivities.length && competitor.lastKnownActivity && activityPlatform(competitor.lastKnownActivity) === platform
                              ? competitor.lastKnownActivity
                              : null;
                            return (
                              <div key={platform}>
                                <span className={`mr-2 rounded-md px-2 py-1 text-xs font-black ${activityPlatformClass(platform)}`}>{platform}</span>
                                {platformActivities.length ? (
                                  <ul className="mt-2 space-y-3">
                                    {platformActivities.map((activity, activityIndex) => (
                                      <li key={`${activity.date}-${activity.sourceUrl}-${activityIndex}`} className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                                        <span className="mr-2 rounded-md bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">{activity.date}</span>
                                        {capturedActivitySummary?.hasPreviousCapture && capturedActivitySummary.newActivityKeys.has(competitorActivityKey(competitor.pageName, activity)) && (
                                          <span className="mr-2 rounded-md bg-emerald-100 px-2 py-1 text-xs font-black uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">{text.newActivity}</span>
                                        )}
                                        {activity.activity}
                                        <a href={activity.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                                          <ExternalLink size={12} />{text.viewEvidence}
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                ) : platformLastKnown ? (
                                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {text.noRecentActivityLastSeen}{' '}
                                    <span className="mr-2 rounded-md bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">{platformLastKnown.date}</span>
                                    {platformLastKnown.activity}{' '}
                                    <a href={platformLastKnown.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                                      <ExternalLink size={12} />{text.viewEvidence}
                                    </a>
                                  </p>
                                ) : (
                                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{text.noRecentActivityForPlatform}</p>
                                )}
                              </div>
                            );
                          })}
                          {(() => {
                            const otherActivities = (competitor.recentActivities || []).filter((activity) => !ACTIVITY_PLATFORM_ORDER.includes(activityPlatform(activity)));
                            const otherLastKnown = !otherActivities.length && competitor.lastKnownActivity && !ACTIVITY_PLATFORM_ORDER.includes(activityPlatform(competitor.lastKnownActivity))
                              ? competitor.lastKnownActivity
                              : null;
                            if (!otherActivities.length && !otherLastKnown) return null;
                            return (
                              <div>
                                <span className={`mr-2 rounded-md px-2 py-1 text-xs font-black ${activityPlatformClass('Web')}`}>Web</span>
                                {otherActivities.length ? (
                                  <ul className="mt-2 space-y-3">
                                    {otherActivities.map((activity, activityIndex) => (
                                      <li key={`${activity.date}-${activity.sourceUrl}-${activityIndex}`} className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                                        <span className="mr-2 rounded-md bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">{activity.date}</span>
                                        {activity.activity}
                                        <a href={activity.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                                          <ExternalLink size={12} />{text.viewEvidence}
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                ) : otherLastKnown ? (
                                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {text.noRecentActivityLastSeen}{' '}
                                    <span className="mr-2 rounded-md bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">{otherLastKnown.date}</span>
                                    {otherLastKnown.activity}{' '}
                                    <a href={otherLastKnown.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                                      <ExternalLink size={12} />{text.viewEvidence}
                                    </a>
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}
                        </dd>
                      </div>
                      {!competitor.recentActivities?.length && !!competitor.publicActivitySignals?.length && <div><dt className="font-bold text-slate-400">{text.publicActivity}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.publicActivitySignals.join(' • ')}</dd></div>}
                      {!!competitor.customerSegments?.length && <div><dt className="font-bold text-slate-400">{text.customerSegments}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.customerSegments.join(' • ')}</dd></div>}
                      <div className="flex flex-wrap gap-3">
                        {competitor.facebookUrl && <a href={competitor.facebookUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-bold text-blue-600 hover:underline"><Facebook size={14} />Facebook</a>}
                        {competitor.tiktokUrl && <a href={competitor.tiktokUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-bold text-slate-800 hover:underline dark:text-slate-100"><ExternalLink size={14} />TikTok</a>}
                        {competitor.linkedinUrl && <a href={competitor.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-bold text-sky-700 hover:underline dark:text-sky-300"><ExternalLink size={14} />LinkedIn</a>}
                        {competitor.sourceUrl && <a href={competitor.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-bold text-blue-600 hover:underline"><ExternalLink size={14} />{text.viewEvidence}</a>}
                      </div>
                    </dl>
                    {!isDemoMode && !!user && (
                      <button
                        type="button"
                        onClick={() => void saveCompetitor(competitor, index)}
                        disabled={savingCompetitorIndex === index}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
                      >
                        {savingCompetitorIndex === index ? <Loader2 size={14} className="animate-spin" /> : savedCompetitorIndex === index ? <Check size={14} /> : <Building2 size={14} />}
                        {savedCompetitorIndex === index ? text.savedCompetitor : text.saveCompetitor}
                      </button>
                    )}
                    {saveCompetitorError?.index === index && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                        <AlertCircle className="mt-0.5 shrink-0" size={14} />{saveCompetitorError.message}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/70 p-6 text-sm leading-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <p>{text.noVerifiedCompetitors}</p>
                {result.researchTarget && <p className="mt-2 font-black">{text.researchTarget}: {result.researchTarget}</p>}
              </div>
            )}
          </section>}

          {!resultIsCompetitorScan && <section>
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
              <div className="grid gap-4 xl:grid-cols-2">
                {result.potentialLeads.map((lead, index) => (
                  <article key={`${lead.pageName}-${index}`} className="glass rounded-3xl p-5">
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
                          {lead.serviceOrJobType && <p className="mt-1 text-xs font-bold text-sky-700 dark:text-sky-300">{text.tradeType}: {lead.serviceOrJobType}</p>}
                        </div>
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {typeof lead.fitScore === 'number' && lead.fitScore > 0 && <span className="rounded-full bg-blue-100 px-3 py-1.5 text-xs font-black text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{text.score}: {lead.fitScore}/100</span>}
                        {(Boolean(lead.needSignals?.length) || (lead.fitScore || 0) > 0) && <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider ${leadBadgeClass(lead.leadLevel)}`}>{lead.leadLevel}</span>}
                      </div>
                    </div>

                    {!isCompetitorLead(lead) && hasLeadSignals(lead) && (
                      <details className="group mt-4 rounded-2xl border border-slate-200 bg-white/60 dark:border-slate-700 dark:bg-slate-900/40">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                          <span className="flex items-center gap-2"><TrendingUp size={15} className="text-emerald-500" />{text.needSignals}</span>
                          <span className="text-base leading-none text-slate-400 transition group-open:rotate-45">+</span>
                        </summary>
                        <div className="border-t border-slate-100 px-4 pb-4 dark:border-slate-800">
                          {!!lead.needSignals?.length && (
                            <ul className="mt-3 space-y-2">
                              {lead.needSignals.map((signal, signalIndex) => <li key={signalIndex} className="flex gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><Check className="mt-1 shrink-0 text-emerald-500" size={15} />{signal}</li>)}
                            </ul>
                          )}
                          {signalGroupsForLead(lead).map((group) => (
                            <div key={group.label} className={`mt-3 rounded-xl border p-3 text-sm ${group.tone}`}>
                              <p className="text-xs font-black uppercase tracking-wider">{group.label}</p>
                              <p className="mt-1 leading-6">{group.items?.join(' • ')}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {!isCompetitorLead(lead) && !!lead.recommendedService && <div className="mt-4 rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
                      <p className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">{text.recommendedService}</p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900 dark:text-emerald-100">{lead.recommendedService}</p>
                    </div>}

                    {isCompetitorLead(lead) ? (
                      <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                            <CalendarDays size={15} />{text.recentActivityTitle}
                          </p>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {result?.activityWindow?.startDate || ''}{result?.activityWindow ? ' – ' : ''}{result?.activityWindow?.endDate || text.recentActivityThroughToday}
                          </span>
                        </div>
                        {lead.recentActivities?.length ? (
                          <ul className="mt-3 space-y-3">
                            {lead.recentActivities.map((activity, activityIndex) => (
                              <li key={`${activity.date}-${activityIndex}`} className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                                <span className="mr-2 rounded-md bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">{activity.date}</span>
                                {activity.activity}
                                <a href={activity.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 font-bold text-blue-600 hover:underline">
                                  <ExternalLink size={12} />{text.viewEvidence}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{text.noRecentActivity}</p>
                        )}
                      </div>
                    ) : (
                      <details open className="group mt-4 rounded-2xl border border-brand-100 bg-white/70 dark:border-slate-700 dark:bg-slate-900/60">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-black uppercase tracking-wider text-brand-500">
                          <span className="flex flex-wrap items-center gap-2"><MessageCircle size={15} />Inbox {businessName && <span className="rounded-full bg-brand-50 px-2 py-1 normal-case tracking-normal text-brand-700 dark:bg-slate-800 dark:text-brand-300">{isKm ? 'ផ្ញើពី' : 'From'} {businessName}</span>}</span>
                          <span className="text-base leading-none text-slate-400 transition group-open:rotate-45">+</span>
                        </summary>
                        <p className="border-t border-brand-50 px-4 py-3 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:text-slate-300">{ensureBusinessInInboxMessage(lead.inboxMessage, businessName)}</p>
                      </details>
                    )}

                    <details className="group mt-4 rounded-2xl border border-brand-100 bg-white/70 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-300">
                        <span className="flex items-center gap-2"><BriefcaseBusiness size={15} />{text.publicContacts}</span>
                        <span className="flex min-w-0 items-center gap-3">
                          {(lead.phone || lead.email) && <span className="hidden max-w-56 truncate font-medium normal-case tracking-normal text-slate-400 sm:block">{lead.phone || lead.email}</span>}
                          <span className="text-base leading-none text-slate-400 transition group-open:rotate-45">+</span>
                        </span>
                      </summary>
                      <div className="space-y-1.5 border-t border-brand-50 px-4 py-3 dark:border-slate-800">
                        <p><span className="font-bold text-slate-400">{text.companyName}: </span>{lead.businessName}</p>
                        {lead.address && <p><span className="font-bold text-slate-400">{text.address}: </span>{lead.address}</p>}
                        {lead.phone && <p><span className="font-bold text-slate-400">{text.call}: </span>{lead.phone}</p>}
                        {lead.email && <p><span className="font-bold text-slate-400">{text.email}: </span><a className="font-semibold text-blue-600 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></p>}
                        {lead.telegram && <p><span className="font-bold text-slate-400">{text.telegram}: </span>{/^(?:https?:\/\/|@)/i.test(lead.telegram) ? <a className="font-semibold text-sky-600 hover:underline" href={lead.telegram.startsWith('@') ? `https://t.me/${lead.telegram.slice(1)}` : lead.telegram} target="_blank" rel="noopener noreferrer">{lead.telegram}</a> : lead.telegram}</p>}
                        {(lead.facebookUrl || lead.facebookPageName) && <p><span className="font-bold text-slate-400">{text.facebookPage}: </span>{lead.facebookUrl ? <a className="font-semibold text-blue-600 hover:underline" href={lead.facebookUrl} target="_blank" rel="noopener noreferrer">{lead.facebookPageName || lead.businessName}</a> : lead.facebookPageName}</p>}
                        {lead.linkedinUrl && <p><span className="font-bold text-slate-400">LinkedIn: </span><a className="font-semibold text-sky-700 hover:underline dark:text-sky-300" href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer">{lead.businessName}</a></p>}
                      </div>
                    </details>

                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                      {lead.facebookUrl && <a href={lead.facebookUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} />{text.viewPage}</a>}
                      {lead.linkedinUrl && <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} />LinkedIn</a>}
                      {lead.evidenceSourceUrl && <a href={lead.evidenceSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-3 py-2 text-xs font-bold text-brand-700 dark:bg-slate-900 dark:text-brand-300"><ExternalLink size={14} />{text.viewEvidence}</a>}
                      {lead.mapsUrl && <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><ExternalLink size={14} />{text.viewMap}</a>}
                      {lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-3 py-2 text-xs font-bold text-brand-700 dark:bg-slate-900 dark:text-brand-300"><ExternalLink size={14} />{text.visitWebsite}</a>}
                      {!isCompetitorLead(lead) && <button onClick={() => void copyInboxMessage(ensureBusinessInInboxMessage(lead.inboxMessage, businessName), index)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{copiedLead === index ? <Check size={14} /> : <Copy size={14} />}{copiedLead === index ? text.copied : text.copyInbox}</button>}
                      {!isCompetitorLead(lead) && !isDemoMode && !!user && telegramBotActive && telegramBotUsername && (
                        <button onClick={() => void startBotChat(lead, index)} title={isKm ? 'ចម្លងតំណ Telegram Bot ដើម្បីផ្ញើទៅអតិថិជន' : 'Copies a Telegram bot link to send this lead'} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700">{chattingLeadIndex === index ? <Check size={14} /> : <MessageCircle size={14} />}{chattingLeadIndex === index ? text.copied : text.chatViaBot}</button>
                      )}
                      {!isCompetitorLead(lead) && !isDemoMode && !!user && lead.email && (
                        <button onClick={() => void sendLeadEmail(lead, index)} disabled={emailSendingIndex === index} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                          {emailSendingIndex === index ? <Loader2 size={14} className="animate-spin" /> : emailSentIndex === index ? <Check size={14} /> : <Mail size={14} />}
                          {emailSentIndex === index ? text.emailSent : text.sendEmail}
                        </button>
                      )}
                      {!isDemoMode && !!user && (
                        <button onClick={() => void saveScannedBusiness(lead, index)} disabled={savingLeadIndex === index} className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-brand-300 dark:hover:bg-slate-800">
                          {savingLeadIndex === index ? <Loader2 size={14} className="animate-spin" /> : savedLeadIndex === index ? <Check size={14} /> : <Users size={14} />}
                          {savedLeadIndex === index
                            ? text.savedToCrm
                            : isCompetitorLead(lead)
                              ? text.saveCompetitor
                              : text.saveToCrm}
                        </button>
                      )}
                    </div>
                    {emailError?.index === index && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                        <AlertCircle className="mt-0.5 shrink-0" size={14} />{emailError.message}
                      </div>
                    )}
                    {saveLeadError?.index === index && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                        <AlertCircle className="mt-0.5 shrink-0" size={14} />{saveLeadError.message}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/70 p-6 text-sm leading-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{text.noVerifiedLeads}</div>
            )}
          </section>}

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
