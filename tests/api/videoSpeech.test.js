import { describe, expect, it, vi, afterEach } from 'vitest';
import { preserveKhmerDuringTranslation, splitKhmerScript, nativeSpeechPrompt, compareKhmerTranscript, extractVideoDialogue, visualOnlyVideoPrompt, wantsSilentVideo } from '../../shared/videoSpeech.js';
const mocks = vi.hoisted(() => ({ narration: vi.fn(), transcribe: vi.fn() }));
vi.mock('../../api/_khmerNarration.js', () => ({ createKhmerNarration: mocks.narration }));
vi.mock('../../api/_openrouter.js', () => ({ transcribeAudioWithOpenRouter: mocks.transcribe }));
import { preparePlanVideoSpeech, verifyUploadedVideoSpeech } from '../../api/_videoSpeech.js';
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('native Khmer video speech', () => {
  it('preserves mixed Khmer dialogue with English product names and numbers', async () => {
    const line = 'សួស្តី AI ជួយការងារ 24 ម៉ោង។';
    expect((await preparePlanVideoSpeech({prompt:`A presenter says in Khmer: ${line}`})).script).toBe(line);
    expect(extractVideoDialogue(`says in Khmer: "${line}". Office lighting.`)).toEqual({script:line,visual:'speaks to the camera. Office lighting.'});
    expect(extractVideoDialogue(`says in Khmer: “${line}” (no subtitles)` ).script).toBe(line);
    expect(mocks.narration).not.toHaveBeenCalled();
  });
  it('distinguishes native speech without overdubbing from an actual silent request', () => {
    for (const prompt of ['Use native Khmer dialogue, no voice-over replacement.', 'Native speech, no voice over.', 'No narration replacement.']) expect(wantsSilentVideo(prompt)).toBe(false);
    for (const prompt of ['silent video', 'no speech', 'no dialogue', 'គ្មានសំឡេង']) expect(wantsSilentVideo(prompt)).toBe(true);
  });
  it('removes old dialogue before adding a segment-specific line', () => {
    const prompt = nativeSpeechPrompt('A presenter says in Khmer: សួស្តី AI។ (no subtitles).', 'អរគុណ។');
    expect(prompt).not.toContain('សួស្តី');
    expect(prompt).toContain('អរគុណ។');
    expect(prompt).toContain('No additional dialogue, subtitles');
    expect(nativeSpeechPrompt('says in Khmer: "សួស្តី។"', '')).not.toContain('សួស្តី');
  });
  it('removes stale English speech and hook directions from an audio-driven visual brief', () => {
    const visual = visualOnlyVideoPrompt('A Cambodian presenter in an office. She speaks in English about competitors.\nHook: Want to know your competitor?\nWarm camera light.');
    expect(visual).not.toMatch(/English|Want to know|Hook:/i);
    expect(visual).toContain('Warm camera light');
  });
  it('preserves Khmer words verbatim and fails closed on dropped or reordered placeholders', async () => {
    const prompt = 'Say សួស្តី មិត្តភក្តិ';
    expect(await preserveKhmerDuringTranslation(prompt, async s => s.replace('Say', 'Speak'))).toBe('Speak សួស្តី មិត្តភក្តិ');
    expect(await preserveKhmerDuringTranslation(prompt, async () => 'Say hello')).toBe(prompt);
    expect(await preserveKhmerDuringTranslation(prompt, async () => '__KHMER_1__ __KHMER_0__')).toBe(prompt);
  });
  it('distributes every word once across clips without cutting Khmer characters', () => {
    const text = 'សួស្តី មិត្តភក្តិ។ '.repeat(12).trim();
    const lines = splitKhmerScript(text, [8,8,8]);
    expect(lines.filter(Boolean).length).toBeGreaterThan(1);
    expect(lines.join('').replace(/\s/g,'')).toBe(text.replace(/\s/g,''));
    expect(lines.every(line => line.length <= 96)).toBe(true);
    expect(() => splitKhmerScript(text,[4])).toThrow();
  });
  it('uses the selected gender and suppresses dialogue in unused segments', () => {
    const male = nativeSpeechPrompt('Office','សួស្តី','Male');
    const female = nativeSpeechPrompt('Office','សួស្តី','Female');
    expect(male).toContain('adult Cambodian man');
    expect(male).toContain('adult Cambodian male voice');
    expect(female).toContain('adult Cambodian woman');
    expect(female).toContain('adult Cambodian female voice');
    expect(male).toContain('normal brisk everyday conversational pace');
    expect(male).toContain('Time each action to begin with its related phrase');
    expect(nativeSpeechPrompt('Office','')).toContain('No speech');
  });
  it('compares actual words, rejects missing, wrong-language and repeated speech', () => {
    expect(compareKhmerTranscript('សួស្តី។','សួស្តី').passed).toBe(true);
    for (const actual of ['', 'hello', 'សួស្តីសួស្តី', 'អរគុណ']) expect(compareKhmerTranscript('សួស្តី',actual).passed).toBe(false);
  });
  it('prepares an Edge-audio Seedance avatar and meaning-based motion', async () => {
    const prepared = await preparePlanVideoSpeech({ prompt:'Office',voiceOverText:'សួស្តី', voiceGender:'Male' });
    expect(prepared.script).toBe('សួស្តី');
    expect(prepared.prompt).toContain('supplied audio');
    expect(prepared.avatarPrompt).toContain('adult Cambodian man');
    expect(prepared.avatarPrompt).toContain('age 18 to 25');
    expect(prepared.avatarPrompt).toContain('company-office attire');
    expect(prepared.avatarPrompt).toContain('supporting Cambodian coworkers or customers');
    expect(prepared.avatarPrompt).toContain('mouth gently closed');
    expect(prepared.motionPrompt).toContain('two small purposeful hand or task gestures');
    expect(prepared.motionPrompt).toContain('Clear, confident and lively');
    expect(prepared.motionPrompt).toContain('Only the primary presenter speaks');
    expect(prepared.motionPrompt).toContain('one continuous action relevant to the topic');
    expect(prepared.mode).toBe('edge-seedance');
    expect(prepared.performanceStyle).toContain('varied pitch');
    expect(mocks.narration).not.toHaveBeenCalled();
  });
  it('fills legacy plans with missing dialogue but respects silent requests', async () => {
    mocks.narration.mockResolvedValue('សួស្តី');
    expect((await preparePlanVideoSpeech({prompt:'Office'})).script).toBe('សួស្តី');
    mocks.narration.mockClear();
    expect((await preparePlanVideoSpeech({prompt:'Office',voiceOverWanted:false})).mode).toBe('silent');
    expect(mocks.narration).not.toHaveBeenCalled();
  });
  it('blocks delivery verification on missing audio or mismatched transcription', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer}));
    mocks.transcribe.mockResolvedValue('hello');
    await expect(verifyUploadedVideoSpeech('https://res.cloudinary.com/demo/video/upload/v1/test.mp4','សួស្តី')).rejects.toMatchObject({ speechVerification: { passed: false, transcript: 'hello', expected: 'សួស្តី' } });
    mocks.transcribe.mockResolvedValue('សួស្តី');
    expect(await verifyUploadedVideoSpeech('https://res.cloudinary.com/demo/video/upload/v1/test.mp4','សួស្តី')).toMatchObject({passed:true,naturalnessReviewed:false});
    expect(mocks.transcribe).toHaveBeenLastCalledWith(expect.objectContaining({format:'wav',languageHint:'Khmer'}));
    expect(String(global.fetch.mock.calls[0][0])).toContain('/f_wav,af_16000/');
    await expect(verifyUploadedVideoSpeech('https://example.com/test.mp4','សួស្តី')).rejects.toThrow('Invalid');
  });
});
