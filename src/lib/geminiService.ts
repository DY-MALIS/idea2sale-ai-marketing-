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
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedulerSuggest', activityLogs, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate suggestions');
      // The AI's raw JSON output is trusted as-is server-side (no schema check) -- a
      // malformed item here (missing reason/dayOfWeek/score) would crash the UI later
      // when it calls .split()/.slice() on an undefined field, so validate shape here
      // instead of trusting the response blindly.
      const items = Array.isArray(data.data) ? data.data : [];
      return items.filter((item: any): item is PostingSuggestion => (
        item && typeof item.dayOfWeek === 'string' && typeof item.hour === 'number'
        && typeof item.reason === 'string' && typeof item.score === 'number'
      ));
    } catch (error) {
      console.error('Error in aiService.suggestBestPostingTimes:', error);
      return [];
    }
  },

  trainAIOnActivity: async (rawDescription: string): Promise<ActivityData[]> => {
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedulerTrain', description: rawDescription }),
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
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedulerDraft', platform, reason, language }),
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
