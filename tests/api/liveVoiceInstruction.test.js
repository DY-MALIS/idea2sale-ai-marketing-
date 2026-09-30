import { describe, expect, it } from 'vitest';
import { liveVoiceLanguageInstruction } from '../../api/_liveVoiceInstruction.js';

describe('live voice language guidance', () => {
  it('keeps Khmer speech and English terms together without Hindi fallback', () => {
    const instruction = liveVoiceLanguageInstruction('auto');
    expect(instruction).toMatch(/Khmer speech must receive natural Cambodian Khmer speech/);
    expect(instruction).toMatch(/English speech must receive English speech/);
    expect(instruction).toMatch(/Khmer and English in one turn/);
    expect(instruction).toMatch(/Hindi/);
    expect(instruction).toMatch(/independently of the app interface language/);
  });

  it('honors a chosen speech language', () => {
    expect(liveVoiceLanguageInstruction('km')).toMatch(/Answer aloud in natural Cambodian Khmer/);
    expect(liveVoiceLanguageInstruction('en')).toMatch(/Answer aloud in natural English/);
  });
});
