// Client for Google's Gemini Live realtime voice API: one open WebSocket where
// the model listens, reasons, and speaks continuously, instead of this app's
// usual record -> stop -> transcribe -> generate-text -> synthesize-speech
// round trip. The browser connects directly to Google (not through this app's
// server) using a short-lived ephemeral token minted by api/_geminiLive.js, so
// mic audio streams out and reply audio streams back with no per-turn HTTP
// request at all -- that's what gets the ~0.5-1s response time instead of ~5-6s.
// Google's own server-side voice-activity detection decides when the user
// started/stopped talking, so unlike the rest of this app's voice flow there is
// no local silence-timeout logic here: audio just streams continuously while
// the session is open.

const GEMINI_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const MIC_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;
// How often a chunk of captured mic audio is sent -- short enough to keep
// latency low, long enough not to spam tiny messages over the socket.
const SEND_CHUNK_MS = 200;

export interface GeminiLiveHandlers {
  onOpen?: () => void;
  onAudioStart?: () => void;
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  onPlaybackComplete?: () => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export interface GeminiLiveSession {
  close: () => void;
}

export interface GeminiLiveSetup {
  voiceName?: string;
  systemInstruction?: string;
}

const floatTo16BitPcm = (input: Float32Array): Int16Array => {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
};

const downsampleTo16kHz = (input: Float32Array, inputSampleRate: number): Float32Array => {
  if (inputSampleRate === MIC_SAMPLE_RATE) return input;
  const ratio = inputSampleRate / MIC_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    output[i] = input[Math.floor(i * ratio)];
  }
  return output;
};

const int16ArrayToBase64 = (samples: Int16Array): string => {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const base64ToInt16Array = (base64: string): Int16Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
};

// Schedules each incoming PCM chunk to start exactly when the previous one
// ends, so streamed audio plays back gaplessly instead of as separate clips
// with silence between them.
class StreamingPcmPlayer {
  private context: AudioContext;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private onFirstAudio?: () => void;
  private hasStartedPlaying = false;
  private turnComplete = false;
  private onPlaybackComplete?: () => void;

  constructor(context: AudioContext, onFirstAudio?: () => void, onPlaybackComplete?: () => void) {
    this.context = context;
    this.onFirstAudio = onFirstAudio;
    this.onPlaybackComplete = onPlaybackComplete;
  }

  enqueue(pcm16: Int16Array) {
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i += 1) float32[i] = pcm16[i] / 0x8000;
    const buffer = this.context.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((node) => node !== source);
      this.finishTurnIfDrained();
    };
    if (!this.hasStartedPlaying) {
      this.hasStartedPlaying = true;
      this.onFirstAudio?.();
    }
  }

  markTurnComplete() {
    this.turnComplete = true;
    this.finishTurnIfDrained();
  }

  private finishTurnIfDrained() {
    if (!this.turnComplete || this.activeSources.length) return;
    this.turnComplete = false;
    this.hasStartedPlaying = false;
    this.nextStartTime = this.context.currentTime;
    this.onPlaybackComplete?.();
  }

  // Gemini's own turn-detection told us the user started talking over the
  // reply -- stop whatever's still queued immediately rather than talking
  // over them for another few seconds of already-scheduled audio.
  stopAll() {
    this.activeSources.forEach((source) => {
      try { source.stop(); } catch { /* already stopped/ended */ }
    });
    this.activeSources = [];
    this.nextStartTime = this.context.currentTime;
    this.hasStartedPlaying = false;
    this.turnComplete = false;
  }
}

export async function connectGeminiLive(
  ephemeralToken: string,
  model: string,
  // Must be created (and, on iOS, resumed) synchronously inside the button's
  // own onClick -- an AudioContext built later from an async chain starts
  // "suspended" on iOS Safari and never produces sound, the same restriction
  // worked around for plain <audio> playback elsewhere in AIAgent.tsx.
  playbackContext: AudioContext,
  handlers: GeminiLiveHandlers = {},
  setupConfig: GeminiLiveSetup = {},
  signal?: AbortSignal,
): Promise<GeminiLiveSession> {
  if (signal?.aborted) throw new DOMException('Live Voice was stopped.', 'AbortError');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } });
  if (signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException('Live Voice was stopped.', 'AbortError');
  }
  const player = new StreamingPcmPlayer(playbackContext, handlers.onAudioStart, handlers.onPlaybackComplete);

  // Reuse the context created and resumed in the button click. A fresh context
  // after the async token/microphone requests can remain suspended on iOS.
  const captureContext = playbackContext;
  const source = captureContext.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but supported in the browsers this
  // interface targets. It lets us send short PCM chunks continuously.
  const processor = captureContext.createScriptProcessor(4096, 1, 1);
  let pendingSamples: Float32Array[] = [];
  let closed = false;
  let ready = false;

  const socket = new WebSocket(`${GEMINI_LIVE_WS_URL}?access_token=${encodeURIComponent(ephemeralToken)}`);
  let settleConnect: ((session: GeminiLiveSession) => void) | null = null;
  let rejectConnect: ((error: Error) => void) | null = null;
  const connected = new Promise<GeminiLiveSession>((resolve, reject) => {
    settleConnect = resolve;
    rejectConnect = reject;
  });
  const readyTimeout = window.setTimeout(() => {
    if (!ready) fail(new Error('Gemini Live did not become ready in time.'));
  }, 15000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', onAbort);
    clearTimeout(readyTimeout);
    clearInterval(sendTimer);
    player.stopAll();
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void playbackContext.close().catch(() => {});
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };
  const fail = (error: Error) => {
    if (closed) return;
    if (!ready) rejectConnect?.(error);
    cleanup();
    handlers.onError?.(error);
  };
  const onAbort = () => {
    if (!ready) rejectConnect?.(new DOMException('Live Voice was stopped.', 'AbortError'));
    cleanup();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    if (!ready || socket.readyState !== WebSocket.OPEN) return;
    pendingSamples.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(captureContext.destination);

  const flushMicAudio = () => {
    if (!ready || !pendingSamples.length || socket.readyState !== WebSocket.OPEN) return;
    const totalLength = pendingSamples.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of pendingSamples) { merged.set(chunk, offset); offset += chunk.length; }
    pendingSamples = [];

    const downsampled = downsampleTo16kHz(merged, captureContext.sampleRate);
    const pcm16 = floatTo16BitPcm(downsampled);
    socket.send(JSON.stringify({
      realtimeInput: {
        audio: { mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}`, data: int16ArrayToBase64(pcm16) },
      },
    }));
  };
  const sendTimer = window.setInterval(flushMicAudio, SEND_CHUNK_MS);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      setup: {
        model: model.startsWith('models/') ? model : `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          ...(setupConfig.voiceName ? {
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setupConfig.voiceName } } },
          } : {}),
        },
        ...(setupConfig.systemInstruction ? {
          systemInstruction: { parts: [{ text: setupConfig.systemInstruction }] },
        } : {}),
      },
    }));
  };

  socket.onmessage = (event) => {
    void (async () => {
      try {
        const raw = typeof event.data === 'string' ? event.data : await (event.data as Blob).text();
        const message = JSON.parse(raw);
        if (message?.setupComplete && !ready) {
          ready = true;
          clearTimeout(readyTimeout);
          settleConnect?.({ close: cleanup });
          handlers.onOpen?.();
        }
        if (message?.error) {
          fail(new Error(message.error.message || 'Gemini Live returned an error.'));
          return;
        }
        const modelTurn = message?.serverContent?.modelTurn;
        const parts: Array<{ inlineData?: { mimeType?: string; data?: string } }> = modelTurn?.parts || [];
        for (const part of parts) {
          const inline = part?.inlineData;
          if (inline?.data && /^audio\//.test(inline.mimeType || '')) {
            player.enqueue(base64ToInt16Array(inline.data));
          }
        }
        if (message?.serverContent?.interrupted) {
          player.stopAll();
          handlers.onInterrupted?.();
        }
        if (message?.serverContent?.turnComplete) {
          handlers.onTurnComplete?.();
          player.markTurnComplete();
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Failed to parse Gemini Live message.'));
      }
    })();
  };

  socket.onerror = () => {
    fail(new Error('Gemini Live connection failed.'));
  };

  socket.onclose = () => {
    if (!ready) rejectConnect?.(new Error('Gemini Live closed before it was ready.'));
    if (closed) return;
    cleanup();
    handlers.onClose?.();
  };

  return connected;
}
