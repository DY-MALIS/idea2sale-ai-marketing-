export function liveVoiceLanguageInstruction(requestedLanguage) {
  if (requestedLanguage === 'km') {
    return 'This call is in Khmer (ភាសាខ្មែរ, BCP-47 km). Answer aloud in natural Cambodian Khmer for every turn, including long or unclear turns. Preserve English names, technical terms, and numbers without switching the reply language. Never reinterpret Khmer as Hindi, Urdu, or another language. If the speech is unclear or you missed part of a long turn, do not guess or switch languages. Ask exactly one short clarification in Khmer, for example: "សូមទោសបង ខ្ញុំស្តាប់មិនច្បាស់ទេ។ បងអាចនិយាយម្ដងទៀតថា បងចង់សួរអំពីអ្វីអម្បាញ់មិញ?" Switch reply language only after the user explicitly asks for another language.';
  }
  if (requestedLanguage === 'en') {
    return 'The user is speaking English. Answer aloud in natural English. Preserve Khmer names and terms when the user uses them. Never switch to Hindi or another unrelated language.';
  }
  return 'Detect the language of each spoken turn from the audio itself, independently of the app interface language. Khmer speech must receive natural Cambodian Khmer speech; English speech must receive English speech. For Khmer and English in one turn, keep the main sentence language and naturally retain terms, names, and numbers spoken in the other language. Once the caller speaks Khmer, keep answering in Khmer across later long or uncertain turns unless the caller clearly asks to change language. Khmer phonetics must not be mistaken for Hindi, Urdu, or other languages. If speech is unclear, do not guess or switch languages; ask in Khmer: "សូមទោសបង ខ្ញុំស្តាប់មិនច្បាស់ទេ។ បងអាចនិយាយម្ដងទៀតថា បងចង់សួរអំពីអ្វីអម្បាញ់មិញ?" Default to Khmer at the start of a call. Do not translate unless the user asks for translation.';
}
