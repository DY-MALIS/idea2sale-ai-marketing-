import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ttsPromise: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  parseBuffer: vi.fn(),
}));

vi.mock('node-edge-tts', () => ({
  // Arrow functions have no [[Construct]] slot, so `new EdgeTTS(...)` with an
  // arrow-function mockImplementation silently produces an empty instance
  // instead of running the body -- this must be a real function expression.
  EdgeTTS: vi.fn().mockImplementation(function EdgeTTS() { this.ttsPromise = mocks.ttsPromise; }),
}));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile, unlink: mocks.unlink }));
vi.mock('music-metadata', () => ({ parseBuffer: mocks.parseBuffer }));

import { synthesizeKhmerSpeechViaEdge } from '../../api/_edgeSpeech.js';

beforeEach(() => {
  // clearAllMocks (not resetAllMocks) -- reset would also wipe the EdgeTTS
  // constructor mockImplementation set above, since it's only set once at
  // module-mock time rather than freshly per test like mocks.ttsPromise is.
  vi.clearAllMocks();
  mocks.unlink.mockResolvedValue(undefined);
  mocks.readFile.mockResolvedValue(Buffer.from('fake-audio-bytes'));
  mocks.parseBuffer.mockResolvedValue({ format: { duration: 2.5 } });
});

it('synthesizes on the first attempt when Edge succeeds', async () => {
  mocks.ttsPromise.mockResolvedValue(undefined);
  const result = await synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី' });
  expect(result).toMatchObject({ duration: 2.5, model: 'edge-km-KH-SreymomNeural', transcript: 'សួស្តី' });
  expect(mocks.ttsPromise).toHaveBeenCalledTimes(1);
});

it('retries once after a rate-limited (429) response and succeeds on the second attempt', async () => {
  mocks.ttsPromise
    .mockRejectedValueOnce(new Error('Unexpected server response: 429'))
    .mockResolvedValueOnce(undefined);
  const result = await synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី' });
  expect(result.duration).toBe(2.5);
  expect(mocks.ttsPromise).toHaveBeenCalledTimes(2);
}, 10000);

it('gives up after exhausting retries on repeated 429s', async () => {
  mocks.ttsPromise.mockRejectedValue(new Error('Unexpected server response: 429'));
  await expect(synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី' })).rejects.toThrow('429');
  expect(mocks.ttsPromise).toHaveBeenCalledTimes(2);
}, 10000);

it('does not retry a 403 -- that means the token/endpoint was rejected outright, not a transient limit', async () => {
  mocks.ttsPromise.mockRejectedValue(new Error('Unexpected server response: 403'));
  await expect(synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី' })).rejects.toThrow('403');
  expect(mocks.ttsPromise).toHaveBeenCalledTimes(1);
});

it('rejects input with no Khmer script before ever calling Edge', async () => {
  await expect(synthesizeKhmerSpeechViaEdge({ input: 'hello' })).rejects.toThrow('Khmer narration text is required.');
  expect(mocks.ttsPromise).not.toHaveBeenCalled();
});

it('rejects an unsupported voice before ever calling Edge', async () => {
  await expect(synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី', voice: 'not-a-real-voice' })).rejects.toThrow('Unsupported Edge Khmer voice.');
  expect(mocks.ttsPromise).not.toHaveBeenCalled();
});

it('cleans up the temp audio file even when synthesis fails', async () => {
  mocks.ttsPromise.mockRejectedValue(new Error('Unexpected server response: 403'));
  await expect(synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី' })).rejects.toThrow();
  expect(mocks.unlink).toHaveBeenCalledTimes(1);
});
