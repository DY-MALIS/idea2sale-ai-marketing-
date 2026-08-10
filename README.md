# aime.angkorgate: AI Marketing Hub

AI marketing automation for TikTok/Facebook/Instagram sellers — copywriting, poster/video generation, TikTok
auto-post, a Telegram-based CRM/scheduler, ad strategy generation, and an AI agent, built as a single shared
workspace (see [PRD.md](PRD.md) for the full feature scope).

This is a single-tenant workspace app: there is one shared Telegram bot for every business using the deployment, so
the Telegram CRM/inbox is one shared workspace, readable only by admins (`admins/{uid}` — see "Firebase Setup"
below). Most other data (scheduled posts, campaigns, business profile) is scoped per Firebase user. There is no
multi-company/RLS layer — see [`src/components/SecurityCenter.tsx`](src/components/SecurityCenter.tsx) (in-app
"Security Overview" page) for the current, accurate state of access control, and [firestore.rules](firestore.rules)
for the source of truth.

## Tech Stack

- Vite, React 19, TypeScript, Tailwind CSS
- Express dev server (`server.ts`, used by `npm run dev`)
- **Production runs on Vercel serverless functions** under `api/*.js` — `server.ts` is local-dev-only and does not
  fully mirror what's deployed. `/api/tiktok/publish` has a separate, older implementation in `server.ts` and can
  drift from `api/tiktok/publish.js` (production) — check both if you change TikTok video publishing behavior.
  `/api/tiktok/publish-photo` and `/api/telegram/run-scheduled` avoid this by having `server.ts` import and mount
  the same handler used in production, so those two can't drift.
- Firebase (Auth + Firestore) for data and auth
- Cloudinary for media hosting (Telegram-scheduled media, TikTok photo posts)
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
5. Grant a user admin rights — required both to delete `tiktok_posts` records and to view the shared Telegram
   CRM/inbox (`crm` and `automation` tabs) — by running:

   ```bash
   npm run grant-admin -- someone@example.com
   # or: npm run grant-admin -- <firebase-uid>
   # revoke with: npm run grant-admin -- someone@example.com --revoke
   ```

   This needs `FIREBASE_PROJECT_ID` and (for production) `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` set in `.env`.
   **Grant yourself admin before deploying `firestore.rules`** — the Telegram CRM/inbox rules now require an
   `admins/{uid}` document to exist, so without this step no one (including you) can read it.

## TikTok Setup

1. Create a TikTok developer app and add the Content Posting API product.
2. Set `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.
3. Set `TIKTOK_SCOPES` to include `video.upload` and `video.publish` — the default `user.info.basic` alone only
   allows read-only profile lookups, not publishing. Anyone who connected TikTok before this scope was added must
   reconnect for the new permission to apply.
4. Leave `TIKTOK_POST_MODE=inbox` (default) until your TikTok app has been audited by TikTok — unaudited apps are
   restricted to private viewing regardless, and `direct` mode requires a `privacy_level` that matches what
   `/creator_info/query/` returns for the connected account.

## Telegram Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_CHAT_ID` to the chat/channel the scheduler should post to — scheduled broadcast posts fail
   silently (status `FAILED`) without it.
3. Register the webhook (`api/telegram/webhook.js`) with Telegram and set `TELEGRAM_WEBHOOK_SECRET`.
4. Scheduled posts are delivered two ways: Upstash QStash for precise-time delivery, and a fallback poller
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

## Known Gaps

- Audit logging (`audit_logs` collection, admin-only read) covers manual Telegram replies, TikTok publish attempts,
  and cron runs — not every write in the app. Extend `api/_audit.js` usage if you need broader coverage.
- No verified backup/restore process for the Firebase project (see Security Overview page in-app). Enabling
  Firestore exports and running a test restore is a manual step in the Firebase console — nothing in this repo can
  do that for you.
- `server.ts` (local dev) and `api/tiktok/publish.js` (production) implement TikTok video publishing separately
  and can drift — production is the source of truth.
- Ads Manager Lite generates AI strategy/creative/scaling guidance only; it does not connect to Meta or TikTok Ads
  accounts, so there is no automated bid/budget management.
