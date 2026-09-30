export type SpokenLanguage = 'km' | 'en' | 'mixed';

export const detectSpokenLanguage = (value: string): SpokenLanguage => {
  const hasKhmer = /[\u1780-\u17FF]/u.test(value);
  const hasEnglish = /[A-Za-z]/u.test(value);
  return hasKhmer && hasEnglish ? 'mixed' : hasKhmer ? 'km' : 'en';
};

export interface SpeechSegment {
  language: 'km' | 'en';
  text: string;
}

// Keep adjacent words in one voice request. Switching only at script changes
// lets an English phrase inside a Khmer answer use an English voice while the
// surrounding Khmer remains with the Khmer voice.
export const splitSpeechByLanguage = (value: string, maxLength = 450): SpeechSegment[] => {
  const tokens = value.match(/[\u1780-\u17FF]+|[A-Za-z]+(?:['’._/-][A-Za-z]+)*|[0-9០-៩]+|\s+|[^\s\u1780-\u17FFA-Za-z0-9០-៩]+/gu) || [];
  const runs: SpeechSegment[] = [];
  for (const token of tokens) {
    if (!token.trim() || !/[\u1780-\u17FFA-Za-z0-9០-៩]/u.test(token)) {
      if (runs.length) runs[runs.length - 1].text += token;
      else if (token.trim()) runs.push({ language: 'en', text: token });
      continue;
    }
    const language: 'km' | 'en' = /[\u1780-\u17FF]/u.test(token)
      ? 'km'
      : /[A-Za-z]/u.test(token)
        ? 'en'
        : runs.at(-1)?.language || 'en';
    if (runs.at(-1)?.language === language) runs[runs.length - 1].text += token;
    else runs.push({ language, text: token });
  }

  const segments: SpeechSegment[] = [];
  for (const run of runs) {
    let remaining = run.text.trim();
    while (remaining.length > maxLength) {
      const prefix = remaining.slice(0, maxLength);
      const breakAt = Math.max(prefix.lastIndexOf('។'), prefix.lastIndexOf('!'), prefix.lastIndexOf('?'), prefix.lastIndexOf('.'), prefix.lastIndexOf(','), prefix.lastIndexOf(' '));
      const cut = breakAt > maxLength / 3 ? breakAt + 1 : maxLength;
      segments.push({ language: run.language, text: remaining.slice(0, cut).trim() });
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) segments.push({ language: run.language, text: remaining });
  }
  return segments.filter((segment) => /[\u1780-\u17FFA-Za-z0-9០-៩]/u.test(segment.text));
};
