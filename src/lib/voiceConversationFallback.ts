import { uint8ArrayToBase64 } from './base64';
import { splitSpeechByLanguage } from './voiceLanguage';
import { advanceVoiceTurn, initialVoiceTurnState } from './voiceTurnDetector';

export interface VoiceConversationFallback {
  close: () => void;
}

export interface FallbackOptions {
  languageHint: () => 'auto' | 'km' | 'en';
  voiceGenderHint?: () => 'Female' | 'Male';
  audioElement: HTMLAudioElement;
  onListening: () => void;
  onThinking: () => void;
  onSpeaking: () => void;
  onReplyComplete: () => void;
  onTranscript: (text: string) => Promise<string>;
  onError: (error: Error) => void;
}

const recorderFormat = (mimeType: string) => mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
const abortError = () => new DOMException('Voice conversation stopped.', 'AbortError');

// Give up on a turn and quietly start listening again once this long has
// passed without the mic ever crossing the speech-detected threshold --
// previously 60s, which left the caller staring at "Listening..." in total
// silence for up to a full minute before anything happened.
const SILENT_TURN_TIMEOUT_MS = 15000;

// Keep a turn short enough for the server request limit; quiet periods do not
// submit fabricated speech to the transcription model.
const recordTurn = async (signal: AbortSignal): Promise<{ audioBase64: string; format: string } | null> => {
  if (signal.aborted) throw abortError();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    throw abortError();
  }
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor || typeof MediaRecorder === 'undefined') {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Voice recording is unavailable in this browser.');
  }
  const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find((type) => MediaRecorder.isTypeSupported(type));
  if (!supported) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('No supported voice recording format was found.');
  }

  let context: AudioContext | null = null;
  try {
    context = new AudioContextCtor();
    await context.resume();
    if (signal.aborted) throw abortError();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    const recorder = new MediaRecorder(stream, { mimeType: supported, audioBitsPerSecond: 32000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const samples = new Float32Array(analyser.fftSize);
    let state = initialVoiceTurnState();
    let lastTick = performance.now();
    let elapsedQuietMs = 0;

    const blob = await new Promise<Blob | null>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (hasSpeech: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        if (timeout) clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        recorder.onstop = () => resolve(hasSpeech ? new Blob(chunks, { type: supported }) : null);
        try {
          if (recorder.state !== 'inactive') recorder.stop();
          else resolve(hasSpeech ? new Blob(chunks, { type: supported }) : null);
        } catch (error) { reject(error); }
      };
      const onAbort = () => { finish(false); };
      signal.addEventListener('abort', onAbort, { once: true });
      recorder.onerror = () => {
        settled = true;
        if (timer) clearInterval(timer);
        if (timeout) clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Voice recording failed.'));
      };
      recorder.start(250);
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const now = performance.now();
        const elapsed = now - lastTick;
        lastTick = now;
        const next = advanceVoiceTurn(state, Math.sqrt(energy / samples.length), elapsed);
        state = next.state;
        elapsedQuietMs = state.heardSpeech ? 0 : elapsedQuietMs + elapsed;
        if (next.shouldSubmit) finish(true);
        else if (elapsedQuietMs >= SILENT_TURN_TIMEOUT_MS) finish(false);
      }, 100);
      timeout = setTimeout(() => finish(state.heardSpeech), 90000);
    });
    if (signal.aborted) throw abortError();
    if (!blob || blob.size < 300) return null;
    return { audioBase64: uint8ArrayToBase64(new Uint8Array(await blob.arrayBuffer())), format: recorderFormat(supported) };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    if (context) void context.close().catch(() => {});
  }
};

const requestJson = async (body: object, signal: AbortSignal) => {
  const response = await fetch('/api/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Voice conversation request failed.');
  return data;
};

const playAudio = (audio: HTMLAudioElement, audioUrl: string, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const cleanup = () => {
    audio.onended = null;
    audio.onerror = null;
    signal.removeEventListener('abort', onAbort);
  };
  const onAbort = () => { audio.pause(); cleanup(); reject(abortError()); };
  signal.addEventListener('abort', onAbort, { once: true });
  audio.onended = () => { cleanup(); resolve(); };
  audio.onerror = () => { cleanup(); reject(new Error('Voice playback failed.')); };
  audio.src = audioUrl;
  void audio.play().catch((error) => { cleanup(); reject(error); });
});

interface FallbackOperations {
  recordTurn: typeof recordTurn;
  requestJson: typeof requestJson;
  playAudio: typeof playAudio;
}

export const runVoiceConversationFallback = async (
  options: FallbackOptions,
  signal: AbortSignal,
  operations: FallbackOperations = { recordTurn, requestJson, playAudio },
) => {
    try {
      while (!signal.aborted) {
        options.onListening();
        const recording = await operations.recordTurn(signal);
        if (!recording) continue;
        options.onThinking();
        const { transcript } = await operations.requestJson({
          action: 'sttTranscribe', ...recording,
          languageHint: options.languageHint() === 'km' ? 'Khmer' : options.languageHint() === 'en' ? 'English' : 'auto',
        }, signal);
        const spoken = String(transcript || '').trim();
        if (!spoken || signal.aborted) continue;
        const reply = await options.onTranscript(spoken);
        if (!reply || signal.aborted) continue;
        options.onSpeaking();
        const cleanReply = reply.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_`>|]/g, ' ').trim();
        const segments = splitSpeechByLanguage(cleanReply);
        const generateSegment = (segment: { text: string; language: string }) => operations.requestJson({
          action: 'ttsGenerate', input: segment.text,
          languageHint: segment.language === 'km' ? 'Khmer' : 'English', conversation: true,
          voice: options.voiceGenderHint?.() === 'Male' ? 'onyx' : undefined,
        }, signal);
        // Start generating the next segment's audio as soon as the current
        // one is ready, overlapping that network round-trip with the current
        // segment's playback instead of waiting for playback to finish first --
        // otherwise a multi-segment (mixed Khmer/English) reply has a dead-air
        // gap between every spoken segment.
        let pending = segments.length ? generateSegment(segments[0]) : null;
        for (let i = 0; i < segments.length; i += 1) {
          if (signal.aborted) break;
          const { audioUrl } = await pending!;
          if (!audioUrl) throw new Error('Voice playback is unavailable.');
          pending = i + 1 < segments.length ? generateSegment(segments[i + 1]) : null;
          await operations.playAudio(options.audioElement, audioUrl, signal);
        }
        options.onReplyComplete();
      }
    } catch (error) {
      if (!signal.aborted) options.onError(error instanceof Error ? error : new Error('Voice conversation failed.'));
    }
};

export const startVoiceConversationFallback = (options: FallbackOptions): VoiceConversationFallback => {
  const controller = new AbortController();
  void runVoiceConversationFallback(options, controller.signal);
  return { close: () => { controller.abort(); options.audioElement.pause(); } };
};
