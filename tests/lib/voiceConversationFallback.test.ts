import { afterEach, expect, it, vi } from 'vitest';
import { runVoiceConversationFallback, startVoiceConversationFallback } from '../../src/lib/voiceConversationFallback';

afterEach(() => vi.unstubAllGlobals());

it('listens again after each spoken answer until the caller ends the conversation', async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const onTranscript = vi.fn(async (text: string) => {
    events.push(`user:${text}`);
    return `Answer to ${text}`;
  });
  const recordTurn = vi.fn()
    .mockResolvedValueOnce({ audioBase64: 'first', format: 'webm' })
    .mockResolvedValueOnce({ audioBase64: 'second', format: 'webm' });
  const requestJson = vi.fn(async (body: any) => body.action === 'sttTranscribe'
    ? { transcript: body.audioBase64 === 'first' ? 'first question' : 'follow-up question' }
    : { audioUrl: `data:audio/mpeg;base64,${body.input}` });
  const playAudio = vi.fn(async () => { events.push('played'); });
  const onError = vi.fn();

  await runVoiceConversationFallback({
    languageHint: () => 'en',
    audioElement: {} as HTMLAudioElement,
    onListening: () => events.push('listening'),
    onThinking: () => events.push('thinking'),
    onSpeaking: () => events.push('speaking'),
    onReplyComplete: () => { events.push('complete'); if (onTranscript.mock.calls.length === 2) controller.abort(); },
    onTranscript,
    onError,
  }, controller.signal, { recordTurn, requestJson, playAudio });

  expect(events).toEqual([
    'listening', 'thinking', 'user:first question', 'speaking', 'played', 'complete',
    'listening', 'thinking', 'user:follow-up question', 'speaking', 'played', 'complete',
  ]);
  expect(onTranscript).toHaveBeenCalledTimes(2);
  expect(recordTurn).toHaveBeenCalledTimes(2);
  expect(onError).not.toHaveBeenCalled();
});

it('releases the microphone when a fallback call is ended while listening', async () => {
  const stopTrack = vi.fn();
  const closeContext = vi.fn().mockResolvedValue(undefined);
  const startRecorder = vi.fn();
  const recorder = {
    state: 'inactive', onstop: null as (() => void) | null,
    ondataavailable: null, onerror: null,
    start: () => { recorder.state = 'recording'; startRecorder(); },
    stop: () => { recorder.state = 'inactive'; recorder.onstop?.(); },
  };
  const FakeMediaRecorder = Object.assign(class {
    constructor() { return recorder; }
  }, { isTypeSupported: () => true });
  const context = {
    resume: vi.fn().mockResolvedValue(undefined), close: closeContext,
    createMediaStreamSource: () => ({ connect: vi.fn() }),
    createAnalyser: () => ({ fftSize: 2048, connect: vi.fn(), getFloatTimeDomainData: vi.fn() }),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    destination: {},
  };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.stubGlobal('window', { AudioContext: class { constructor() { return context; } } });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  const audioElement = { pause: vi.fn() } as unknown as HTMLAudioElement;
  const onError = vi.fn();
  const call = startVoiceConversationFallback({
    languageHint: () => 'auto', audioElement,
    onListening: vi.fn(), onThinking: vi.fn(), onSpeaking: vi.fn(), onReplyComplete: vi.fn(),
    onTranscript: vi.fn(), onError,
  });

  await vi.waitFor(() => expect(startRecorder).toHaveBeenCalledOnce());
  call.close();
  await vi.waitFor(() => expect(closeContext).toHaveBeenCalledOnce());
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(audioElement.pause).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalled();
});

it('gives up a silent turn and listens again well before a full minute of silence', async () => {
  vi.useFakeTimers();
  try {
    const stopTrack = vi.fn();
    const recorder = {
      state: 'inactive', onstop: null as (() => void) | null,
      ondataavailable: null, onerror: null,
      start: () => { recorder.state = 'recording'; },
      stop: () => { recorder.state = 'inactive'; recorder.onstop?.(); },
    };
    const FakeMediaRecorder = Object.assign(class {
      constructor() { return recorder; }
    }, { isTypeSupported: () => true });
    const context = {
      resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: () => ({ connect: vi.fn() }),
      // Silence: the analyser always reports a flat (all-zero) buffer, so the
      // mic never crosses the speech threshold and the turn must fall back
      // to the quiet-timeout instead of advanceVoiceTurn's shouldSubmit.
      createAnalyser: () => ({ fftSize: 2048, connect: vi.fn(), getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0) }),
      createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
      destination: {},
    };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
    vi.stubGlobal('window', { AudioContext: class { constructor() { return context; } } });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const controller = new AbortController();
    const listenCalls: number[] = [];
    const onTranscript = vi.fn();
    void runVoiceConversationFallback({
      languageHint: () => 'en',
      audioElement: {} as HTMLAudioElement,
      onListening: () => { listenCalls.push(Date.now()); if (listenCalls.length === 2) controller.abort(); },
      onThinking: vi.fn(), onSpeaking: vi.fn(), onReplyComplete: vi.fn(),
      onTranscript, onError: vi.fn(),
    }, controller.signal);

    await vi.waitFor(() => expect(listenCalls.length).toBeGreaterThan(0));
    // Advance just past the shortened quiet-timeout, not the old 60s one --
    // if the regression came back this would still be silently "listening".
    await vi.advanceTimersByTimeAsync(15001);
    await vi.waitFor(() => expect(listenCalls.length).toBe(2));
    expect(onTranscript).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
