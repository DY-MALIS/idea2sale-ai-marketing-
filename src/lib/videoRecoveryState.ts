type SavedStart = {
  expectedScript?: string;
  silentRequested?: boolean;
  resumeNarration?: { text: string; voice: string; languageHint: 'Khmer' | 'English'; performanceStyle: string };
  aspectRatio?: string;
};

type StartResponse = { spokenScript?: string; outputAspectRatio?: string };

// A lost start response may be recovered after the original UI state is
// gone. Keep the user's narration and silence choices with the start request.
export const videoOptionsFromRecoveredStart = (start: SavedStart, response: StartResponse) => ({
  expectedScript: response.spokenScript || start.expectedScript || undefined,
  silentRequested: start.silentRequested,
  resumeNarration: start.resumeNarration,
  aspectRatio: response.outputAspectRatio || start.aspectRatio,
});
