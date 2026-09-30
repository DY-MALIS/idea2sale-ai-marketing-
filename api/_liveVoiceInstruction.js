export function liveVoiceLanguageInstruction(requestedLanguage) {
  if (requestedLanguage === 'km') {
    return 'The user is speaking Khmer (ភាសាខ្មែរ, BCP-47 km). Listen for Khmer phonetics and meaning. Answer aloud in natural Cambodian Khmer. Preserve English names, technical terms, and numbers when the user uses them. Never reinterpret Khmer as Hindi, Urdu, or another language. If a word is unclear, ask a brief clarification in Khmer.';
  }
  if (requestedLanguage === 'en') {
    return 'The user is speaking English. Answer aloud in natural English. Preserve Khmer names and terms when the user uses them. Never switch to Hindi or another unrelated language.';
  }
  return 'Detect the language of each spoken turn from the audio itself, independently of the app interface language. Khmer speech must receive natural Cambodian Khmer speech; English speech must receive English speech. For Khmer and English in one turn, keep the main sentence language and naturally retain terms, names, and numbers spoken in the other language. Khmer phonetics must not be mistaken for Hindi, Urdu, or other languages. If unclear, ask a brief clarification in the most recent clear language, defaulting to Khmer at the start of a call. Do not translate unless the user asks for translation.';
}
