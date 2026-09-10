# Khmer avatar video speech

Khmer Content Plan and Video & Voice videos synthesize the exact Khmer script with Edge Neural
TTS, upload that audio and a presenter portrait, then send both references to
`bytedance/seedance-2.0:free` through OpenRouter for an audio-driven talking video.

- `voiceOverText` stores the exact 35-55 character Khmer sentence.
- `voiceOverMode` is `edge-seedance` for new plan videos.
- `voiceGender` controls whether the portrait is an adult Cambodian man or woman.
- `motionPrompt` asks for one meaning-based gesture and rejects repeated waving,
  random pointing, oversized movements and slow delivery.
- Generated audio is transcribed after video generation. A mismatch blocks
  delivery and retains the video for review. A passing transcript enters REVIEW:
  the owner must watch and listen, then approve pronunciation, pace, lip sync and
  gestures. Approval queues the existing video in scheduled_posts for the next
  scheduler run; it does not generate a new video. Retry uses an authenticated
  server transaction instead of a client write denied by Firestore rules.
- Video & Voice also requires a manual quality check before publishing Khmer
  speech. Turning off voice-over removes the audio track from the result.

Standalone Khmer narration uses the online neural voices provided by Microsoft
Edge without Azure credentials. Male requests map to `km-KH-PisethNeural` and
female requests map to `km-KH-SreymomNeural`. The audio is provided as a
Seedance reference so the generated mouth motion can follow the same track that
viewers hear.

The Khmer neural speech rate is +20%. The video prompt specifies the measured
audio duration and normal-speed, phrase-timed gestures, so short speech should
not be stretched across the full eight-second clip. Delivery attaches the exact
original reference audio to the generated video; missing reference audio or
audio longer than eight seconds fails instead of generating a different track.
These are generation controls, not proof of clear pronunciation or accurate
lip sync. Review a newly generated clip with sound to confirm both.

No live generation should run without explicit approval because the portrait,
Seedance video and transcription can each incur provider charges.
