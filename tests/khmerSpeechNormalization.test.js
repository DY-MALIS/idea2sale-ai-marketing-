import { describe, expect, it } from 'vitest';
import { normalizeForKhmerSpeech } from '../api/_openrouter.js';

describe('Khmer speech text preparation', () => {
  it('preserves a Khmer zero-width word boundary as a space', () => {
    expect(normalizeForKhmerSpeech('សួស្តី\u200Bអ្នក')).toBe('សួស្តី អ្នក');
  });
  it('keeps mixed Khmer and English words', () => {
    expect(normalizeForKhmerSpeech('សូមទស្សនា OpenAI ថ្ងៃនេះ')).toContain('OpenAI');
  });
});
