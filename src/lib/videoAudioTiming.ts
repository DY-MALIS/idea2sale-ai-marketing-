// Positive values delay speech; negative values bring speech forward.
// The final video keeps its original duration by padding the audio tail.
export const audioShiftFilter = (offsetMs: number): string => {
  if (!Number.isInteger(offsetMs) || Math.abs(offsetMs) > 1000) {
    throw new Error('Audio timing adjustment must be within one second.');
  }
  if (offsetMs >= 0) return `adelay=${offsetMs}:all=1,apad`;
  return `atrim=start=${(-offsetMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,apad`;
};

export const lastAudibleSpeechSecond = (pcm: Uint8Array, sampleRate = 24000): number | null => {
  const windowSamples = Math.round(sampleRate / 100); // 10 ms
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let lastActiveWindow = -1;
  for (let window = 0; (window + 1) * windowSamples <= sampleCount; window++) {
    let sumSquares = 0;
    for (let sample = window * windowSamples; sample < (window + 1) * windowSamples; sample++) {
      const value = samples.getInt16(sample * 2, true);
      sumSquares += value * value;
    }
    if (Math.sqrt(sumSquares / windowSamples) >= 150) lastActiveWindow = window;
  }
  return lastActiveWindow < 0 ? null : (lastActiveWindow + 1) * windowSamples / sampleRate;
};
