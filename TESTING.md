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

## Scheduler (TikTok)

- Connecting TikTok (any "Connect TikTok" button) persists an access/refresh token to the server-only
  `tiktok_automation_tokens` collection (`api/tiktok/callback.js`) — confirm no client SDK can read or write that
  collection (Firestore rules deny it outright, admins included).
- A TikTok post scheduled a few seconds in the future via Smart Scheduler is accepted, not rejected as "in the
  past", and stays `PENDING` until the cron picks it up.
- `api/tiktok/publish.js?action=cron` (protected by `CRON_SECRET`, same header/query-param check as
  `api/telegram/run-scheduled.js`) publishes due `PENDING` TikTok posts and flips them to `PUBLISHED`/`FAILED`;
  a successful run also creates a `tiktok_posts` doc so it shows up in the "Recent TikTok Syncs" widget.
- If TikTok has never been connected (no stored automation token), the cron leaves due posts `PENDING` instead of
  failing them — connecting TikTok afterward should let the next cron tick publish them automatically.
- A post stuck in `PROCESSING` for more than 3 minutes (simulated timeout) gets reset to `PENDING` by the next
  cron run's stale-recovery step, instead of being stuck forever.
- Two separate `scheduled_posts` docs with the same `videoUrl` (a double-submitted schedule form) only publish
  once to TikTok — the second is flipped straight to `PUBLISHED` with `duplicateSkipped: true` instead of posting
  again (`findRecentDuplicateTikTokPost` in `api/_telegramClaim.js`).
- Disconnecting TikTok (`TikTokAnalytics.tsx`'s "Disconnect" button → `api/tiktok/me.js?action=disconnect`)
  requires a signed-in Firebase user — an unauthenticated `POST` to that endpoint is rejected with 401 and does
  not delete the stored automation token.

## Scheduler (Telegram)

- Scheduling a post for a time a few seconds in the future is accepted (grace-period check), not rejected as "in
  the past".
- A scheduled post fires at the right time via QStash.
- If QStash delivery is missed, the fallback GitHub Action poller (`telegram-scheduler.yml`, every 10 min) still
  delivers it within its polling window.
- A scheduled post fails with a clear error if `TELEGRAM_CHAT_ID` is not configured, instead of hanging silently.
- Media over 48 MB is rejected with a clear error before upload.
- A duplicate/late QStash delivery for the same Content Plan video item (both invocations see `status:
  PROCESSING`) only posts to Telegram once — the second invocation's delivery claim fails and it returns
  `skipped: 'already-sending'` instead of sending a second copy (`processContentPlanVideo` in
  `api/telegram/deliver.js`).

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
