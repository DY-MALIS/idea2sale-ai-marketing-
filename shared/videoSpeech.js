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
    while (index < lines.length && (lines[index] + token).trim().length > durations[index] * 8) index++;
    if (index === lines.length) throw new Error('អត្ថបទនិយាយវែងពេក។ សូមបន្ថយអត្ថបទ ឬជ្រើសវីដេអូវែងជាងនេះ។');
    lines[index] += token;
  }
  return lines.map(s => s.trim());
}

export function nativeSpeechPrompt(visual, script, gender = 'Female', performanceStyle = '') {
  const male = gender === 'Male';
  const presenter = male ? 'adult Cambodian man' : 'adult Cambodian woman';
  const voice = male
    ? 'an unmistakably adult Cambodian male voice with a natural masculine pitch and resonance'
    : 'an unmistakably adult Cambodian female voice with a natural feminine pitch and resonance';
  const delivery = String(performanceStyle || '').trim();
  return `${extractVideoDialogue(visual).visual}\n\nAUDIO DIRECTION: Generate audio together with the video. ${script
    ? `Cast exactly one ${presenter}. The visible speaker's face, body and voice must all match that sex consistently. Use ${voice}; never substitute an androgynous voice, a childlike voice, or a voice of the other sex. The presenter speaks directly to the camera and says exactly in Cambodian Khmer: ${JSON.stringify(script)}. The visible presenter is the only source of the voice. Generate the voice, breathing, facial performance and mouth movements together in the original video; do not add off-camera narration or a separate voice-over. Use crisp native Cambodian Khmer pronunciation at a normal brisk everyday conversational pace. Do not speak slowly, stretch vowels, insert long dramatic pauses, rush, sing or recite. Use only brief natural pauses at phrase boundaries and finish every word clearly. ${delivery ? `PERFORMANCE DIRECTION: ${delivery}. ` : ''}Synchronize lips, jaw and facial motion precisely with every spoken word. Derive gestures from the meaning of each phrase: one small illustrative gesture on the key idea, relaxed hands between phrases, natural blinking and subtle weight shifts. Time each gesture to begin with its related phrase and settle when that phrase ends. Avoid generic waving, repeated nodding, pointing at empty space, random hand motion, oversized movements, frozen poses and theatrical reactions. Keep both hands below shoulder height and preserve a relaxed upright posture. Use one continuous stable eye-level medium shot with face, chest and hands visible. No additional dialogue, subtitles, captions, text, music, group montage or slow motion.`
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
