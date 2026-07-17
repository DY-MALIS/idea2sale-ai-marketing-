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
  | 'security-center';

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
  mediaName?: string | null;
  mediaType?: 'photo' | 'video' | null;
  videoUrl?: string;
  videoName?: string | null;
  telegramMessageId?: number | null;
  errorMessage?: string | null;
  createdAt?: any;
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
