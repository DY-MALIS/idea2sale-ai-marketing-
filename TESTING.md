# Test Plan

Manual test checklist for this app's actual architecture (Firebase Auth + Firestore, single shared workspace —
see [README.md](README.md) and the in-app Security Overview page for what "shared" vs "per-user" means here).

## Authentication

- User can sign up, log in, and log out via Firebase Auth.
- Unauthenticated users cannot read another user's `scheduled_posts`, `campaigns`, `reply_rules`,
  `audience_activity`, or `business_profiles` documents (Firestore rules should reject this — try it directly
  against the Firestore SDK, not just through the UI).
- Deactivated Firebase users cannot obtain a valid session for routes that check `disabled` status
  (`requireFirebaseSession` in `server.ts` — note this guard currently only applies to `server.ts`-only routes,
  not to every `api/*.js` Vercel function; check which endpoints actually need it).

## Firestore Data Isolation

- User A cannot read or write User B's `scheduled_posts`, `campaigns`, `reply_rules`, `audience_activity`, or
  `business_profiles` (each is gated by `userId == request.auth.uid`).
- Any signed-in user CAN read `telegram_leads` and `telegram_messages` — confirm this is the intended behavior
  (single shared CRM/inbox) before adding a second unrelated business to this deployment.
- `tiktok_posts` is publicly readable by design (analytics widget) — confirm no sensitive data is ever written
  into that collection.
- Deleting a `tiktok_posts` document requires an `admins/{uid}` document to exist for the caller.

## TikTok Publishing

- Connecting TikTok (OAuth popup) succeeds and `/api/tiktok/me` returns the connected profile.
- Video publish (`VideoVoice.tsx` → `api/tiktok/publish.js`) fails with a clear scope error if
  `TIKTOK_SCOPES` lacks `video.upload`/`video.publish`, and succeeds once scopes are correct and the account is
  reconnected.
- Photo publish (`PosterGen.tsx` → `api/tiktok/publish-photo.js`) uploads the generated poster to Cloudinary and
  successfully calls the TikTok photo content-posting endpoint.
- `TIKTOK_POST_MODE=inbox` (default) lands content in the TikTok inbox/draft; test `direct` mode separately since
  it requires an audited app and a valid `privacy_level`.

## Scheduler (Telegram)

- Scheduling a post for a time a few seconds in the future is accepted (grace-period check), not rejected as "in
  the past".
- A scheduled post fires at the right time via QStash.
- If QStash delivery is missed, the fallback GitHub Action poller (`telegram-scheduler.yml`, every 10 min) still
  delivers it within its polling window.
- A scheduled post fails with a clear error if `TELEGRAM_CHAT_ID` is not configured, instead of hanging silently.
- Media over 48 MB is rejected with a clear error before upload.

## AI Features

- Copywriter, poster generation, video generation, and TTS each show a clear error (not a silent failure) when
  the relevant API key is missing or the provider call fails.
- Khmer-language voice-over does not silently fall back to a lower-quality voice without telling the user (see
  the quality notice in `VideoVoice.tsx`).
- AI Agent voice input recognizes the language explicitly selected by the user, independent of the UI display
  language.

## UI/UX

- Loading states appear for auth, uploads, AI generation, and TikTok connect/publish actions.
- Errors surfaced to the user are human-readable, not raw stack traces or provider error JSON.
- Khmer and English UI modes render without broken or truncated text.
- Mobile layout is usable for Copywriter, PosterGen, VideoVoice, Scheduler, and AI Agent — the primary workflows.
