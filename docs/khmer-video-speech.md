# Khmer video speech

Khmer narration uses Gemini TTS through OpenRouter's `/api/v1/audio/speech`
with the existing server-only `OPEN_ROUTER_API_KEY` (or `OPENROUTER_API_KEY`)
and optional `OPEN_ROUTER_TTS_GEMINI_MODEL` (default
`google/gemini-3.1-flash-tts-preview`). No separate Google TTS key is required.
The browser never receives this key. A missing
key fails explicitly, and a provider failure does not switch to Azure, Translate
or a different speech model. The existing OpenRouter integration still generates video.

Gemini receives exact script text plus separate performance and plan context.
Male maps to Charon and female to Kore. Audio is decoded as mono PCM and wrapped
in a WAV container at Gemini's 24 kHz rate (or the explicit returned rate).
OpenRouter's generation ID is returned for usage tracking. Video footage is requested
without dialogue, then Gemini narration replaces the original audio. This is
narration, not automatic lip synchronization. Khmer remains unverified for
naturalness; selecting Gemini does not guarantee pronunciation quality.

- Visual prompt translation protects the original Khmer characters with
  placeholders. Missing, duplicated or reordered placeholders restore the
  original prompt instead of changing the spoken words.
- Browser generation divides the script at Khmer word boundaries across the
  requested 4/6/8-second clips. Text that exceeds the conservative character
  budget is rejected before creating video jobs. This budget is a heuristic,
  not a measurement of speaking duration.
- Each clip receives its own Gemini narration using the selected voice.
  Duration is checked without speeding up or truncating speech. Calendar audio
  is generated, uploaded and transcribed before starting the video job, then
  reused at delivery rather than generated again.
- Calendar generation prepares and saves `voiceOverText`, `voiceOverMode` and
  `generationPrompt` alongside the job, with mode `gemini`. Existing embedded Khmer dialogue is
  preserved; a missing script is generated before starting the video.
- Browser clips are transcribed from extracted WAV audio. Calendar videos use
  Cloudinary's 16 kHz WAV rendition. Normalized character similarity must be at least
  90%; empty or non-Khmer transcription fails. Errors fail closed. No automatic
  paid regeneration is triggered by a speech mismatch.
- On calendar verification failure, `resultMediaUrl` is retained and the item
  is marked `FAILED` with an explanation. Telegram delivery is skipped. An older
  in-flight job without reference dialogue also requires review rather than
  being sent unverified.

Transcript matching does not evaluate naturalness, emotional delivery, voice
continuity or lip sync. `naturalnessReviewed: false` records this explicitly.
Listen to the output and inspect the visible speaker before treating a sample
as a quality reference. ASR errors can reject otherwise correct speech.

Validation: `npm test`, `npm run lint`, `npm run build`. The optional manual
`scratchpad/native-khmer-check.mjs` creates one persisted 8-second test job with
`start`, then downloads and verifies the same job with `poll`. It never sends
to Telegram, changes a plan row, or silently starts another job.

## Live verification, 2026-09-09

Two 8-second samples used the exact line `ចាប់ផ្តើមពីការងារដដែលៗ។`:
the configured default video model and an explicit `google/veo-3.1` comparison.
Both samples generated downloadable videos but failed transcription comparison.
Rechecking the standard sample as WAV also returned non-Khmer transcription.
The existing standard Khmer TTS reference returned Khmer with a word mismatch
(approximately 89.4% similarity), demonstrating that transcription can itself
make errors. Neither new video was published to Telegram. These results do not
establish human speech naturalness or lip sync; human listening is still needed.
The comparison does not change the application's configured video model.
