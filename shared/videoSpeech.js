export const wantsSilentVideo = (prompt = '') => /\b(?:silent|no (?:speech|voice(?![- ]over| replacement)|narration(?! replacement)|talking|dialogue))\b|គ្មានសំឡេង|មិនបាច់និយាយ/i.test(prompt);

// Quoted dialogue supports mixed languages, numbers and punctuation. Legacy
// unquoted dialogue ends at a sentence boundary, newline or stage direction.
export function extractVideoDialogue(prompt = '') {
  const lines = [];
  const visual = prompt.replace(/(?:says?|dialogue)\s+in\s+Khmer\s*:\s*(?:"([^"\n]*)"|“([^”\n]*)”|([^\n(។!?]+[។!?]?))/giu, (match, straight, curly, plain) => {
    const line = (straight ?? curly ?? plain ?? '').trim();
    if (!/[\u1780-\u17ff]/u.test(line)) return match;
    lines.push(line);
    return 'speaks to the camera';
  });
  return { script: lines.join(' '), visual };
}

// Keep spoken text outside visual translation. A failed placeholder round trip
// falls back to the original request rather than changing the user's words.
export async function preserveKhmerDuringTranslation(prompt, translate) {
  const parts = [];
  const masked = prompt.replace(/[\u1780-\u17ff\u200b]+/gu, text => {
    const token = `__KHMER_${parts.length}__`;
    parts.push({ token, text });
    return token;
  });
  const translated = await translate(masked);
  if (typeof translated !== 'string' || parts.some(({token}) => translated.split(token).length !== 2)) return prompt;
  if (parts.some((part, i) => i > 0 && translated.indexOf(part.token) < translated.indexOf(parts[i-1].token))) return prompt;
  return parts.reduce((text, part) => text.replace(part.token, part.text), translated);
}

export function splitKhmerScript(text, durations) {
  if (!durations.length || durations.some(d => ![4, 6, 8].includes(d))) throw new Error('Invalid speech segment durations.');
  const tokens = [...new Intl.Segmenter('km', { granularity: 'word' }).segment(text.trim())].map(s => s.segment);
  const lines = durations.map(() => '');
  let index = 0;
  for (const token of tokens) {
    // Conservative text budget, not a claim about measured speech duration.
    while (index < lines.length && (lines[index] + token).trim().length > durations[index] * 6) index++;
    if (index === lines.length) throw new Error('អត្ថបទនិយាយវែងពេក។ សូមបន្ថយអត្ថបទ ឬជ្រើសវីដេអូវែងជាងនេះ។');
    lines[index] += token;
  }
  return lines.map(s => s.trim());
}

export function nativeSpeechPrompt(visual, script, gender = 'Female') {
  return `${extractVideoDialogue(visual).visual}\n\nAUDIO DIRECTION: Generate audio together with the video. ${script
    ? `One native Cambodian ${gender === 'Male' ? 'male' : 'female'} speaker says exactly in Khmer: ${JSON.stringify(script)}. Natural human conversational delivery, clear pronunciation, gentle emotion and unhurried pauses. No additional dialogue. Synchronize visible speaking mouths with the words.`
    : 'No speech or dialogue in this segment; ambient sound only.'}`;
}

export function compareKhmerTranscript(expected, actual) {
  const clean = s => String(s || '').normalize('NFC').replace(/[\p{P}\p{Z}\s\u200b]/gu, '');
  const a = [...clean(expected)], b = [...clean(actual)];
  if (!a.length || !b.length || !/[\u1780-\u17ff]/u.test(actual)) return { passed: false, similarity: 0 };
  let row = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]+1, row[j]+1, row[j-1]+(a[i-1] === b[j-1] ? 0 : 1));
    row = next;
  }
  const similarity = 1 - row[b.length] / Math.max(a.length, b.length);
  return { passed: similarity >= 0.9, similarity };
}
