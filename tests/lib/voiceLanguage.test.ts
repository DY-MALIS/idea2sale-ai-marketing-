import { expect, it } from 'vitest';
import { detectSpokenLanguage, splitSpeechByLanguage } from '../../src/lib/voiceLanguage';

it('detects Khmer, English, and mixed spoken requests', () => {
  expect(detectSpokenLanguage('សួស្តី')).toBe('km');
  expect(detectSpokenLanguage('Hello agent')).toBe('en');
  expect(detectSpokenLanguage('សួស្តី Hello agent')).toBe('mixed');
});

it('keeps each language in the original speaking order', () => {
  expect(splitSpeechByLanguage('សួស្តី Hello there! សុខសប្បាយទេ?')).toEqual([
    { language: 'km', text: 'សួស្តី' },
    { language: 'en', text: 'Hello there!' },
    { language: 'km', text: 'សុខសប្បាយទេ?' },
  ]);
});

it('keeps numbers in the surrounding language and splits long speech', () => {
  expect(splitSpeechByLanguage('តម្លៃ 20 ដុល្លារ')).toEqual([
    { language: 'km', text: 'តម្លៃ 20 ដុល្លារ' },
  ]);
  const segments = splitSpeechByLanguage('Hello '.repeat(90), 100);
  expect(segments.length).toBeGreaterThan(1);
  expect(segments.every((segment) => segment.text.length <= 100 && segment.language === 'en')).toBe(true);
});
