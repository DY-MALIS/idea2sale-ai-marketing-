export interface VoiceTurnState {
  elapsedMs: number;
  speechMs: number;
  silenceMs: number;
  heardSpeech: boolean;
}

export const initialVoiceTurnState = (): VoiceTurnState => ({
  elapsedMs: 0,
  speechMs: 0,
  silenceMs: 0,
  heardSpeech: false,
});

// End a live turn only after real speech followed by a natural pause. Room
// silence alone must never submit an empty clip to transcription.
export const advanceVoiceTurn = (
  previous: VoiceTurnState,
  rms: number,
  elapsedMs: number,
  threshold = 0.012,
): { state: VoiceTurnState; shouldSubmit: boolean } => {
  const delta = Math.max(0, Math.min(500, elapsedMs));
  const speaking = rms >= threshold;
  const speechMs = speaking ? previous.speechMs + delta : Math.max(0, previous.speechMs - delta * 2);
  const heardSpeech = previous.heardSpeech || speechMs >= 240;
  const silenceMs = heardSpeech ? speaking ? 0 : previous.silenceMs + delta : 0;
  const state = { elapsedMs: previous.elapsedMs + delta, speechMs, silenceMs, heardSpeech };
  return { state, shouldSubmit: heardSpeech && (silenceMs >= 1700 || state.elapsedMs >= 90000) };
};
