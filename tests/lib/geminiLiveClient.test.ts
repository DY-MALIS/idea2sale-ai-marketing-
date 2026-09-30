import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectGeminiLive } from '../../src/lib/geminiLiveClient';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Gemini Live browser connection', () => {
  it('waits for setup and streams microphone PCM through the constrained audio endpoint', async () => {
    vi.useFakeTimers();
    const sent: any[] = [];
    let socket: any;
    let processor: any;
    const track = { stop: vi.fn() };
    const captureContext = {
      sampleRate: 16000,
      destination: {},
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createScriptProcessor: () => (processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const FakeWebSocket = class {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      url: string;
      constructor(url: string) { this.url = url; socket = this; }
      send(value: string) { sent.push(JSON.parse(value)); }
      close() { this.readyState = 3; }
    };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', { AudioContext: class { constructor() { return captureContext; } }, setInterval, setTimeout });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const playbackContext = { close: vi.fn().mockResolvedValue(undefined) } as unknown as AudioContext;

    const pending = connectGeminiLive('ephemeral-token', 'gemini-3.8-live', playbackContext, {}, {
      voiceName: 'Aoede', systemInstruction: 'Speak Khmer for Khmer input.',
    });
    await vi.waitFor(() => expect(socket).toBeDefined());
    expect(socket.url).toContain('v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=ephemeral-token');
    socket.readyState = FakeWebSocket.OPEN;
    socket.onopen();
    expect(sent[0]).toEqual({ setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
      },
      systemInstruction: { parts: [{ text: 'Speak Khmer for Khmer input.' }] },
    } });

    processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0.5, -0.5]) } });
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);
    socket.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
    const session = await pending;
    processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0.5, -0.5]) } });
    vi.advanceTimersByTime(200);
    expect(sent[1].realtimeInput.audio).toMatchObject({ mimeType: 'audio/pcm;rate=16000', data: expect.any(String) });
    expect(sent[1].realtimeInput).not.toHaveProperty('mediaChunks');
    session.close();
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
