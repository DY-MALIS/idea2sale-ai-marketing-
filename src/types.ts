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

export interface FacebookCompetitorInsight {
  pageName: string;
  topAngle: string;
  offerStrategy: string;
  weakness: string;
  counterStrategy: string;
}

export interface FacebookPotentialLead {
  source?: 'facebook_ads' | 'google_places' | 'web_search';
  businessName: string;
  pageName: string;
  businessType: string;
  needSignals: string[];
  facebookUrl: string;
  address?: string;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  publicContact: string;
  leadLevel: 'Hot' | 'Warm' | 'Cold';
  recommendedService: string;
  inboxMessage: string;
  evidenceSourceUrl?: string;
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
  adsFound?: number;
  metaApiAvailable?: boolean;
  placesFound?: number;
  placesApiAvailable?: boolean;
  webBusinessesFound?: number;
  webSearchAvailable?: boolean;
  customerInsights: FacebookCustomerInsights;
  competitors: FacebookCompetitorInsight[];
  potentialLeads: FacebookPotentialLead[];
  videoPlan: FacebookVideoPlanItem[];
  summaryReport: string;
}

export interface CreativeAutomationRequest {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  platform: 'TikTok' | 'Facebook' | 'X' | 'Telegram' | 'General';
  aspectRatio: '1:1' | '9:16' | '16:9' | '4:5' | '3:4';
  language: 'km' | 'en';
  voiceOverText?: string;
  duration?: number;
}

export interface ScheduleHandoffRequest {
  id: string;
  kind: 'image' | 'video';
  mediaDataUrl: string;
  mediaName: string;
  caption: string;
}

export interface SchedulePost {
  id: string;
  content: string;
  platform: 'TIKTOK' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM';
  scheduledTime: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
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
  directory: BusinessDirectoryEntry[];
  // Optional: lets a user post scheduled Telegram content to their own channel
  // instead of the app's shared default one (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID).
  telegramBotToken?: string;
  telegramChatId?: string;
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
