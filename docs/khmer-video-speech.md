# Khmer avatar video speech

Khmer Content Plan and Video & Voice videos synthesize the exact Khmer script with Gemini TTS
(falling back to Edge Neural), upload that audio and a presenter portrait, then send both references to
`bytedance/seedance-2.0-mini` through OpenRouter for an audio-driven talking video.

- `voiceOverText` stores the exact 65-90 character Khmer sentence.
- `voiceOverMode` is `edge-seedance` for new plan videos.
- `voiceGender` controls whether the portrait is an adult Cambodian man or woman.
- `motionPrompt` asks for one meaning-based gesture and rejects repeated waving,
  random pointing, oversized movements and slow delivery.
- Generated audio is transcribed after video generation. A mismatch blocks
  delivery and marks the item failed. A passing transcript is the automatic
  quality gate: Content Plan videos publish directly to the connected Telegram
  channel and finish as DONE without waiting for manual approval.
- Video & Voice also requires a manual quality check before publishing Khmer
  speech. Turning off voice-over removes the audio track from the result.

Khmer narration uses Gemini TTS first for a more natural voice. If it is
unavailable, the fallback uses Microsoft Edge neural voices without Azure
credentials: male requests map to `km-KH-PisethNeural` and female requests map
to `km-KH-SreymomNeural`. The portrait and audio are both sent through
`input_references`; mixing `frame_images` with `input_references` would switch
OpenRouter to image-to-video mode and can prevent the audio from driving lips.

For presenter videos, the generated narration is trimmed only at its silent
beginning and end before it is uploaded as the video model's audio reference.
The identical trimmed file is muxed into the delivered video. Clip length is
then fitted to that measured narration, with a small safety margin, to reduce
mouth motion before speech and after it ends. The Edge presenter rate is +12%
by default (+6% for standalone speech); an overlong read may be retried faster.
Missing reference audio or audio longer than eight seconds fails instead of
generating a different track. These controls reduce timing drift but cannot
guarantee frame-accurate lip shapes from the generative video model. Review a
newly generated clip with sound to confirm pronunciation and lip sync.

No live generation should run without explicit approval because the portrait,
Seedance video and transcription can each incur provider charges.
