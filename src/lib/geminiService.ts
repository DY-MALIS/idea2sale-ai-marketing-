export interface ActivityData {
  dayOfWeek: string;
  hour: number;
  intensity: number;
}

export interface PostingSuggestion {
  dayOfWeek: string;
  hour: number;
  reason: string;
  score: number;
}

export const geminiService = {
  suggestBestPostingTimes: async (activityLogs: ActivityData[], language: string = 'en'): Promise<PostingSuggestion[]> => {
    try {
      const response = await fetch('/api/scheduler-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest', activityLogs, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate suggestions');
      return data.data || [];
    } catch (error) {
      console.error('Error in aiService.suggestBestPostingTimes:', error);
      return [];
    }
  },

  trainAIOnActivity: async (rawDescription: string): Promise<ActivityData[]> => {
    try {
      const response = await fetch('/api/scheduler-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'train', description: rawDescription }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to train AI');
      return data.data || [];
    } catch (error) {
      console.error('Error in aiService.trainAIOnActivity:', error);
      return [];
    }
  },

  generateContentDraft: async (platform: string, reason: string, language: string = 'en'): Promise<string> => {
    try {
      const response = await fetch('/api/scheduler-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft', platform, reason, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate draft');
      return String(data.text || '').trim();
    } catch (error) {
      console.error('Error generating content draft:', error);
      return 'Engaging content coming soon! #StayTuned';
    }
  }
};
