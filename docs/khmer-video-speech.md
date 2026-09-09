# Khmer avatar video speech

Khmer Content Plan videos synthesize the exact Khmer script with Edge Neural
TTS, upload that audio and a presenter portrait, then send both references to
`bytedance/seedance-2.0:free` through OpenRouter for an audio-driven talking video.

- `voiceOverText` stores the exact 35-55 character Khmer sentence.
- `voiceOverMode` is `edge-seedance` for new plan videos.
- `voiceGender` controls whether the portrait is an adult Cambodian man or woman.
- Optional `OPEN_ROUTER_HEYGEN_MALE_VOICE_ID` and
  `OPEN_ROUTER_HEYGEN_FEMALE_VOICE_ID` select explicit Khmer-compatible voices.
- `motionPrompt` asks for one meaning-based gesture and rejects repeated waving,
  random pointing, oversized movements and slow delivery.
- Generated audio is transcribed after video generation. A mismatch is recorded
  and reported, while scheduled Telegram delivery continues as requested.

Standalone Khmer narration uses the online neural voices provided by Microsoft
Edge without Azure credentials. Male requests map to `km-KH-PisethNeural` and
female requests map to `km-KH-SreymomNeural`. The audio is provided as a
Seedance reference so the generated mouth motion can follow the same track that
viewers hear.

No live generation should run without explicit approval because the portrait,
Seedance video and transcription can each incur provider charges.
