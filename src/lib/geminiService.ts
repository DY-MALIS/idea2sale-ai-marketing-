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

// None of these three calls had a timeout -- a hung /api/ai response left the
// caller's loading flag (e.g. Suggestions.tsx's addingPost, AITrainer.tsx's
// isTraining) stuck true forever, since each caller's own finally block never
// runs until this fetch settles. Every caller here already treats a failure as
// non-fatal (falls back to an empty array / placeholder text), so timing out
// cleanly is strictly an improvement, never a new failure mode.
const AI_FETCH_TIMEOUT_MS = 30000;
const fetchAiWithTimeout = (body: unknown) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS);
  return fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));
};

export const geminiService = {
  suggestBestPostingTimes: async (activityLogs: ActivityData[], language: string = 'en'): Promise<PostingSuggestion[]> => {
    try {
      const response = await fetchAiWithTimeout({ action: 'schedulerSuggest', activityLogs, language });
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
      const response = await fetchAiWithTimeout({ action: 'schedulerTrain', description: rawDescription });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to train AI');
      // Same reasoning as suggestBestPostingTimes above: the AI's raw JSON is
      // untrusted. AITrainer.tsx spreads each item straight into a Firestore
      // write with no shape check of its own -- Firestore's security rules do
      // still reject a malformed doc (dayOfWeek/hour/intensity are validated
      // there too), but catching it here gives a clean empty result instead of
      // a failed batch write with a generic error.
      const items = Array.isArray(data.data) ? data.data : [];
      return items.filter((item: any): item is ActivityData => (
        item && typeof item.dayOfWeek === 'string' && typeof item.hour === 'number'
        && typeof item.intensity === 'number'
      ));
    } catch (error) {
      console.error('Error in aiService.trainAIOnActivity:', error);
      return [];
    }
  },

  generateContentDraft: async (platform: string, reason: string, language: string = 'en'): Promise<string> => {
    try {
      const response = await fetchAiWithTimeout({ action: 'schedulerDraft', platform, reason, language });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate draft');
      return String(data.text || '').trim();
    } catch (error) {
      console.error('Error generating content draft:', error);
      return 'Engaging content coming soon! #StayTuned';
    }
  }
};
