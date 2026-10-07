// Positive values delay speech; negative values bring speech forward.
// The final video keeps its original duration by padding the audio tail.
export const audioShiftFilter = (offsetMs: number): string => {
  if (!Number.isInteger(offsetMs) || Math.abs(offsetMs) > 1000) {
    throw new Error('Audio timing adjustment must be within one second.');
  }
  if (offsetMs >= 0) return `adelay=${offsetMs}:all=1,apad`;
  return `atrim=start=${(-offsetMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,apad`;
};
