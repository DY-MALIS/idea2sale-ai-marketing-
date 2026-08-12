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
  | 'security-center';

export interface CreativeAutomationRequest {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  platform: 'TikTok' | 'Facebook' | 'X' | 'Telegram' | 'General';
  aspectRatio: '1:1' | '9:16' | '16:9' | '4:5' | '3:4';
  language: 'km' | 'en';
  voiceOverText?: string;
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
