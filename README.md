# aime.angkorgate: AI Marketing Hub

AI marketing automation for TikTok/Facebook/Instagram sellers — copywriting, poster/video generation, TikTok
auto-post, a Telegram-based CRM/scheduler, ad strategy generation, and an AI agent (see [PRD.md](PRD.md) for the full feature scope).

Each Firebase user has one business profile and owner-scoped posts, campaigns, Telegram bot/channel settings, and
TikTok authorization. Administrators can inspect data across accounts; legacy leads from the original shared bot
remain administrator-only. Multiple staff logins for one company are not grouped into a company workspace. See
[`src/components/SecurityCenter.tsx`](src/components/SecurityCenter.tsx) and [firestore.rules](firestore.rules)
for access details.

## Tech Stack

- Vite, React 19, TypeScript, Tailwind CSS
- Express dev server (`server.ts`, used by `npm run dev`)
- **Production runs on Vercel serverless functions** under `api/*.js` — `server.ts` is local-dev-only and does not
  fully mirror what's deployed. `/api/tiktok/publish` has a separate, older implementation in `server.ts` and can
  drift from `api/tiktok/publish.js` (production) — check both if you change TikTok video publishing behavior.
  `/api/tiktok/publish-photo` and `/api/telegram/run-scheduled` avoid this by having `server.ts` import and mount
  the same handler used in production, so those two can't drift.
- Firebase (Auth + Firestore) for data and auth
- ImageKit for media hosting (Telegram-scheduled media, TikTok photo posts)
- Upstash QStash for precise-time scheduled delivery
- Gemini / OpenRouter for AI generation (copy, images, video, TTS)
- TikTok Content Posting API for publishing

## Local Setup

1. Install dependencies.

```bash
npm install
```

2. Copy environment variables and fill them in (see comments in the file for what each integration needs).

```bash
cp .env.example .env
```

3. Start the app.

```bash
npm run dev
```

## Firebase Setup

1. Create a Firebase project with Authentication and Firestore enabled.
2. Deploy `firestore.rules` to the project.
3. Fill in the `VITE_FIREBASE_*` client config values from the Firebase console.
4. For server-side Firestore Admin access on Vercel, set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from a
   service account key (Project Settings → Service Accounts). Without these, the server falls back to Application
   Default Credentials, which only works in environments that provide them.
5. Grant a user admin rights to delete `tiktok_posts` records and inspect cross-account or legacy shared-bot
   Telegram CRM data by running:

   ```bash
   npm run grant-admin -- someone@example.com
   # or: npm run grant-admin -- <firebase-uid>
   # revoke with: npm run grant-admin -- someone@example.com --revoke
   ```

   This needs `FIREBASE_PROJECT_ID` and (for production) `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` set in `.env`.
   Standard users can view leads and messages from their own activated Telegram bot without admin rights.

## TikTok Setup

1. Create a TikTok developer app and add the Content Posting API product.
2. Set `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.
3. Set `TIKTOK_SCOPES` to include `video.upload`, `video.publish`, `user.info.profile`, and `video.list` — the
   default `user.info.basic` alone only allows read-only basic profile lookups, not publishing, a bio/verified
   badge, or reading the connected account's own video list. Anyone who connected TikTok before a scope was added
   must reconnect for the new permission to apply.
4. Leave `TIKTOK_POST_MODE=inbox` (default) until your TikTok app has been audited by TikTok — unaudited apps are
   restricted to private viewing regardless, and `direct` mode requires a `privacy_level` that matches what
   `/creator_info/query/` returns for the connected account.
5. **Scheduled/auto-post videos** (Smart Scheduler → TikTok) publish via a cron job
   (`api/tiktok/publish.js?action=cron`), not a browser session, so it needs its own persisted token: connect
   TikTok once (any "Connect TikTok" button) after deploying — `api/tiktok/callback.js` then stores the
   access/refresh token in `tiktok_automation_tokens/{uid}` for that account's cron jobs to use and auto-refresh.
   Existing connections stored under the old shared `default` document must reconnect. A scheduled post stays
   `PENDING` until its own account connects. The cron runs via `vercel.json` (once daily) and the GitHub Action fallback poller
   (`telegram-scheduler.yml`, every 10 minutes) — same `CRON_SECRET` as the Telegram poller.
6. **Webhooks**: in the Content Posting API product's Webhooks section, set the callback URL to
   `https://<your-domain>/api/tiktok/webhook` (a `vercel.json` rewrite maps this to
   `api/tiktok/publish.js?action=webhook` — a dedicated file would be the deployment's 13th serverless function,
   which the Hobby plan rejects). Subscribe to `authorization.removed`: the app verifies the `Tiktok-Signature`
   header with `TIKTOK_CLIENT_SECRET` and, on that event, marks the stored automation token revoked and alerts
   admins immediately instead of only discovering the disconnect from a string of failed scheduled posts.

## ImageKit Setup

1. Create an ImageKit account and open Developer options in the ImageKit dashboard.
2. Copy the public key, private key, and URL endpoint into `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, and
   `IMAGEKIT_URL_ENDPOINT`. The endpoint normally looks like `https://ik.imagekit.io/your_id`.
3. Keep `IMAGEKIT_PRIVATE_KEY` server-side only. The app returns only a short-lived upload signature and the public
   key to authenticated browsers; it never sends the private key to the client.
4. Add the same three variables to Vercel Production before deploying this migration.

## Telegram Setup

1. For each company login, create its own bot via [@BotFather](https://t.me/BotFather). Save its token and public
   channel username (`@mychannel` or `https://t.me/mychannel`) in that login's Business Profile, then add that bot as
   an administrator of the channel. A numeric channel/chat ID is supported when no username is saved. If both are
   present, the username wins. Every post uses only that account's bot and destination.
2. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are not used as fallbacks for publishing. A post without an owner or
   without the owner's bot and destination is blocked instead of going to a shared channel.
3. Set `TELEGRAM_ADMIN_CHAT_ID` to a private administrator chat/group to receive best-effort publishing and AI
   delivery failure alerts. Do not reuse the public `TELEGRAM_CHAT_ID` for internal alerts.
4. Register the webhook (`api/telegram/webhook.js`) with Telegram and set `TELEGRAM_WEBHOOK_SECRET`.
5. Scheduled posts are delivered two ways: Upstash QStash for precise-time delivery, and a fallback poller
   (`.github/workflows/telegram-scheduler.yml`, every 10 minutes) that calls `/api/telegram/run-scheduled`. Confirm
   the GitHub Action is enabled on the repo — Vercel's own cron entry for the same endpoint only runs once a day
   and is not sufficient on its own.

## Deployment to Vercel

1. Set all server secrets in the Vercel project's environment variables (not just locally in `.env`).
2. Build with `npm run build`.
3. Deploy — `vercel.json` handles cron scheduling and SPA rewrites; every file under `api/` is auto-deployed as a
   serverless function.
4. Confirm `APP_URL` matches the deployed domain (used to build TikTok/Telegram redirect and webhook URLs).
5. Set `CRON_SECRET` in Vercel — `/api/telegram/run-scheduled` now refuses to run without it (fails closed, not
   optional). Also add the same value as a `CRON_SECRET` secret on the GitHub repo (Settings → Secrets → Actions),
   since `.github/workflows/telegram-scheduler.yml` sends it as a bearer token. Vercel Cron sends it automatically
   once the env var is set; the GitHub Action needs the repo secret to match.
6. In Firebase Console, enable Firestore point-in-time recovery or scheduled backups, then perform a restore test
   into a separate scratch project. The application-level JSON backup does not replace managed disaster recovery.
7. Enable Firebase alerts for unusual Authentication activity and monitor Firestore rule denials; these events are
   not visible to the application when Firebase rejects them before request handling.

## Known Gaps

- Audit logging (`audit_logs`, admin-only read) covers key operational actions: Telegram replies, publish/cron
  actions, scheduler changes, Smart Reply rules, automation status, audience training, business-profile updates,
  and backup/restore. High-frequency AI chat autosaves are intentionally excluded.
- Admins can download and merge-restore a versioned JSON application backup in Security Center. Firebase
  point-in-time recovery / managed exports are still a separate production safeguard that must be enabled and
  verified in Firebase.
- `server.ts` (local dev) and `api/tiktok/publish.js` (production) implement TikTok video publishing separately
  and can drift — production is the source of truth.
- Ads Manager Lite generates AI strategy/creative/scaling guidance only; it does not connect to Meta or TikTok Ads
  accounts, so there is no automated bid/budget management.
