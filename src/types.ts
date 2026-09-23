export interface Lead {
  id: string;
  name: string;
  email: string;
  source: string;
  service: string;
  status: 'New' | 'Contacted' | 'Qualified' | 'Closed';
  date: string;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  platform: 'Facebook' | 'TikTok' | 'Telegram';
  scheduledDate: string;
  status: 'Draft' | 'Scheduled' | 'Published';
  imageUrl?: string;
}

export type TabType =
  | 'copywriter'
  | 'poster-gen'
  | 'video-voice'
  | 'tiktok'
  | 'product-research'
  | 'ads-manager'
  | 'scheduler'
  | 'ai-agent'
  | 'crm'
  | 'saved-leads'
  | 'automation'
  | 'security-center'
  | 'facebook-scanner';

export interface TargetPersona {
  name: string;
  description: string;
  buyingTriggers: string;
}

export interface FacebookCustomerInsights {
  whatTheyBought: string[];
  whatTheyLike: string[];
  contentDesires: string[];
  targetPersonas: TargetPersona[];
}

export interface FacebookRecentActivity {
  date: string;
  activity: string;
  jobTitle?: string;
  sourceUrl: string;
  platform?: 'Facebook' | 'TikTok' | 'LinkedIn' | 'Web';
  contentType?: 'Video' | 'Reel' | 'Post' | 'Article' | 'Event' | 'Offer' | 'Ad' | 'Other';
  title?: string;
  summary?: string;
  keyDetails?: string[];
}

export interface FacebookMarketTrend {
  topic: string;
  date: string;
  evidence: string;
  opportunity: string;
  sourceUrl: string;
}

export interface FacebookCompetitorInsight {
  pageName: string;
  matchReason?: string;
  topAngle: string;
  offerStrategy: string;
  weakness: string;
  counterStrategy: string;
  sourceUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  linkedinUrl?: string;
  publicActivitySignals?: string[];
  recentActivities?: FacebookRecentActivity[];
  lastKnownActivity?: FacebookRecentActivity;
  customerSegments?: string[];
}

export interface FacebookPotentialLead {
  source?: 'web_search';
  businessName: string;
  entityKind?: 'company' | 'contractor_team' | 'service_provider' | 'freelancer' | 'job_seeker';
  serviceOrJobType?: string;
  pageName: string;
  businessType: string;
  needSignals: string[];
  facebookUrl: string;
  linkedinUrl?: string;
  facebookPageName?: string;
  address?: string;
  phone?: string;
  email?: string;
  telegram?: string;
  website?: string;
  mapsUrl?: string;
  publicContact: string;
  leadLevel: 'Hot' | 'Warm' | 'Cold';
  recommendedService: string;
  inboxMessage: string;
  evidenceSourceUrl?: string;
  opportunityType?: 'customer' | 'ai_interest' | 'market_trends' | 'high_value' | 'construction' | 'competitor_activity' | 'competitor_customers' | 'hiring' | 'workers';
  fitScore?: number;
  interestSignals?: string[];
  spendingSignals?: string[];
  hiringSignals?: string[];
  jobTypes?: string[];
  competitorSignals?: string[];
  recentActivities?: FacebookRecentActivity[];
}

export interface FacebookVideoPlanItem {
  date: string;
  day: string;
  type: 'video';
  topic: string;
  hook: string;
  targetDesire: string;
  prompt: string;
  voiceGender: 'Male' | 'Female';
  voiceOverText: string;
  performanceStyle: string;
  suggestedPostTime: string;
  cta: string;
  selected?: boolean;
}

export interface FacebookScanResult {
  success: boolean;
  query: string;
  webBusinessesFound?: number;
  webSearchAvailable?: boolean;
  scanMode?: FacebookPotentialLead['opportunityType'];
  researchTarget?: string;
  activityWindow?: { startDate: string; endDate: string };
  customerInsights: FacebookCustomerInsights;
  competitors: FacebookCompetitorInsight[];
  marketTrends?: FacebookMarketTrend[];
  potentialLeads: FacebookPotentialLead[];
  videoPlan: FacebookVideoPlanItem[];
  summaryReport: string;
}

export interface CreativeAutomationRequest {
  id: string;
  kind: 'image' | 'video';
  imageMode?: 'poster' | 'visual';
  prompt: string;
  platform: 'TikTok' | 'YouTube' | 'Facebook' | 'X' | 'Telegram' | 'General';
  aspectRatio: '1:1' | '9:16' | '16:9' | '4:5' | '3:4';
  language: 'km' | 'en';
  voiceOverText?: string;
  duration?: number;
  headline?: string;
  cta?: string;
  posterStyle?: string;
}

export interface ScheduleHandoffRequest {
  id: string;
  kind: 'image' | 'video';
  mediaDataUrl: string;
  mediaName: string;
  caption: string;
  preferredPlatform?: 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM';
}

export interface SchedulePost {
  id: string;
  content: string;
  platform: 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM';
  scheduledTime: string;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';
  userId: string;
  aiSuggested: boolean;
  publishMode?: string;
  mediaUrl?: string;
  mediaDataUrl?: string;
  mediaDbKey?: string | null;
  mediaName?: string | null;
  mediaType?: 'photo' | 'video' | null;
  videoUrl?: string;
  videoName?: string | null;
  telegramMessageId?: number | null;
  errorMessage?: string | null;
  localOnly?: boolean;
  createdAt?: any;
}

export interface BusinessDirectoryEntry {
  id: string;
  name: string;
  type: 'COMPANY' | 'INDIVIDUAL';
}

export interface BusinessProfileData {
  businessName: string;
  logoDataUrl: string;
  // What the business actually sells/offers, in the owner's own words -- the
  // one piece of self-knowledge every AI feature (competitor research, ad
  // copy, video prompts) needs before it can judge what's actually relevant,
  // rather than working from the business name alone.
  businessDescription?: string;
  directory: BusinessDirectoryEntry[];
  // Optional: lets a user post scheduled Telegram content to their own channel
  // instead of the app's shared default one (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID).
  telegramBotToken?: string;
  telegramChatId?: string;
  // Set server-side by activateOwnBot (api/telegram/webhook.js) via Telegram's
  // getMe -- lets the client build a t.me/<username>?start=<id> deep link
  // without ever needing the bot token itself.
  telegramBotUsername?: string;
  telegramBotActive?: boolean;
}

export interface AudienceActivity {
  id: string;
  dayOfWeek: string;
  hour: number;
  intensity: number;
  userId: string;
  updatedAt: string;
}

export interface PostingSuggestion {
  dayOfWeek: string;
  hour: number;
  reason: string;
  score: number;
}
