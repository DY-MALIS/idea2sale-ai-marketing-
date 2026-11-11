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
- **Production runs on Vercel serverless functions** under `api/*.js`. The local Express server (`server.ts`) mounts
  the same handlers for TikTok publishing, Telegram scheduling, and the other main API routes. Check Vercel's
  functions when verifying production behavior; the local server still has some compatibility routes.
- Firebase (Auth + Firestore) for data and auth
- ImageKit for legacy media; Cloudflare R2 for new media when enabled
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
2. Deploy `firestore.rules` and `firestore.indexes.json` to the project. The scheduled-post pollers need the composite index for platform, status, and scheduled time before the updated cron queries can run.
3. Fill in the `VITE_FIREBASE_*` client config values from the Firebase console.
4. For server-side Firestore Admin access on Vercel, set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from a
   service account key (Project Settings → Service Accounts). The server rejects Admin SDK operations if these are missing.
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
   The Developer Portal's **Direct Post** switch enables the API but does not remove the **Reapply** usage
   restriction; TikTok must approve its audit before public Direct Post works. The app transfers videos with
   `FILE_UPLOAD`, so **Verify domains** is not needed for this video flow (it applies to `PULL_FROM_URL`).
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

## YouTube Setup

1. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI` for the Google OAuth app. The redirect URI must end with `/api/tiktok/callback?provider=youtube`.
2. Each signed-in user connects their own YouTube channel from Smart Scheduler. YouTube tokens are stored by Firebase UID. Connections created before this owner-scoped change used a shared `default` token and must reconnect.
3. YouTube schedules use QStash for precise delivery, the GitHub Action poller every 10 minutes as a fallback, and the daily Vercel cron as a further fallback. Configure `QSTASH_TOKEN`, both QStash signing keys, and `CRON_SECRET` for those paths.
4. For connections that last beyond seven days, set the Google Auth Platform audience to **External / In production** in the same Google Cloud project as `YOUTUBE_CLIENT_ID`. An External app in **Testing** receives refresh tokens that expire after seven days when requesting `youtube.upload`. Keep YouTube Data API v3 enabled, add the exact production redirect URI, and declare `https://www.googleapis.com/auth/youtube.upload` in Data Access. After switching to production, existing test connections should reconnect to receive a new refresh token.
5. For customers outside your team, complete Google's OAuth verification for the requested scope. Prepare the public app homepage, privacy policy, authorized domain, support contact, scope explanation, and an end-to-end demo of connecting a channel and scheduling an upload. Google may show an unverified-app warning and impose a user cap until approval. OAuth verification and any YouTube API compliance audit are separate processes. A production refresh token can still be revoked by its owner or expire after prolonged non-use; reconnect when that happens.

## Facebook Page Reel Setup

1. In a Meta developer app with Facebook Login, request `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`. Configure the valid OAuth redirect URI as `https://aime.angkorgate.ai/api/tiktok/callback?provider=facebook` (or the equivalent `APP_URL` for another deployment).
2. Create a Facebook Login for Business configuration with a user access token and the three Page permissions, then set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and `FACEBOOK_CONFIG_ID` as server-only environment variables in Vercel Production. Keep `APP_URL` set to the same deployed domain. Do not put the app secret or a Page token in a `VITE_` variable.
3. Deploy the app and Firestore rules. In Smart Scheduler, sign in, connect Facebook, and choose a Page you can create content on. Upload one portrait 9:16 video lasting 4–60 seconds, then select Facebook with any other destinations and schedule once.
4. Page credentials are stored by Firebase UID in `facebook_automation_tokens`, which browser clients cannot read. QStash triggers delivery at the scheduled time; the GitHub Action and Vercel cron retry due posts. The Scheduler shows `SUBMITTED` while Meta processes the Reel, then `PUBLISHED` or `FAILED` after confirmation.
5. To let customers outside the Meta app's roles connect their own Pages, a person with full control of the Meta Business Account must complete Business Verification. Confirm the exact legal record with that person before selecting it in Meta. Complete the separate Tech Provider Access Verification when Meta enables it after Business Verification. In App Review, request Advanced Access for `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`; provide the required descriptions, end-to-end screen recordings, and API test calls. The legal entity and its data-handling owner must answer Meta's data-handling questionnaire and compliance declarations. Meta also requires a 1024 x 1024 app icon before submission; `public/app-icon.png` has that size. A published Meta app alone does not grant these permissions to people outside its roles.
6. After approval, test with a Facebook account that has no role on the Meta app and has content access to its own Page. Connect it in Smart Scheduler, select its Page, schedule a photo or Reel, and confirm that the post appears on that Page and in Content Timeline. Saving a Page URL in Business Profile does not authorize publishing. The current scheduler supports Page photos and Reels, not text-only posts or personal profiles.

## Cloudflare R2 media storage

1. Create an R2 bucket in Cloudflare and attach a public custom domain. Set bucket CORS to permit `PUT` from `https://aime.angkorgate.ai` with `Content-Type`, and `GET`/`HEAD` for playback. Keep access and secret keys server-side. Cloudflare's [presigned PUT guide](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) shows the required CORS policy.
   Example CORS policy: `[{"AllowedOrigins":["https://aime.angkorgate.ai"],"AllowedMethods":["GET","HEAD","PUT"],"AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag","Content-Length"],"MaxAgeSeconds":3600}]`.
2. Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_URL` (the HTTPS custom domain, without trailing slash) to Vercel Production and local `.env`. Set `MEDIA_STORAGE_PROVIDER=r2` only after a direct upload and playback test.
3. New generated media and scheduled uploads then use R2. Existing ImageKit URLs continue to work. Private business-profile documents still use ImageKit's private-file verification, so retain its keys until those files have a separate migration.
4. R2 is billed beyond its free allowance; configure a budget alert and lifecycle policy for old media. The storage switch does not automatically copy or delete any existing ImageKit files.

## ImageKit Setup (primary media and private files)

### Optional Cloudinary fallback for exhausted ImageKit uploads

1. Create a Cloudinary Free product environment. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` as **server-only** Vercel Production variables. Do not use a `VITE_` prefix or share the API secret in chat.
2. After a signed upload and playback test, set `CLOUDINARY_FALLBACK_ENABLED=true` and redeploy. ImageKit stays primary. Only a quota-related ImageKit upload rejection sends the same new file to Cloudinary. Other upload errors remain visible.
3. Existing ImageKit media is not copied. If ImageKit delivery bandwidth or Cloudinary Free credits run out, older URLs may also become unavailable. Monitor both providers; this fallback does not provide unlimited free storage or delivery.

1. Create an ImageKit account and open Developer options in the ImageKit dashboard.
2. Copy the public key, private key, and URL endpoint into `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, and
   `IMAGEKIT_URL_ENDPOINT`. The endpoint normally looks like `https://ik.imagekit.io/your_id`.
3. Keep `IMAGEKIT_PRIVATE_KEY` server-side only. The app returns only a short-lived upload signature and the public
   key to authenticated browsers; it never sends the private key to the client.
4. Add the same three variables to Vercel Production before deploying this migration.

## Telegram Setup

### Content approval bot

`@dgacademy_official_bot` uses the bot owner's saved `telegramBotToken` and `/api/telegram/webhook?uid=<bot-owner-uid>` webhook, and accepts connections from other website accounts. Keep that owner bot active with `message` and `callback_query` webhook updates; activating it again in Business Profile registers the current update list. Business Profile's **Check connection** reports whether the owner's webhook accepts approval buttons and whether their private chat is linked. The deployment-wide `TELEGRAM_BOT_TOKEN` belongs to a different bot and is not used for approvals. Set `APP_URL` to the deployed website origin so the bot sends the correct Google connection link. Other owner bots retain their separate sign-in flows.

Any existing website account can send `/login` to `@dgacademy_official_bot` in a private chat. The bot sends a single-use, 10-minute website link. The user continues with Google on the website; Firebase verifies the existing account, and the app binds that Firebase UID to the Telegram user ID. A new Google account created from the link is refused: sign up on the website first, then request a fresh bot link. Existing email/password users can link Google to their current Firebase account on the connection page; this preserves their UID and data. `/logout` disconnects the chat. Linked accounts receive their own Yes/No approvals in this shared bot. A linked account with a saved Telegram channel publishes there when the bot and linked Telegram user have posting access. Accounts without a saved channel can use `@aimarketingengine` when `TELEGRAM_SHARED_BOT_OWNER_UID` and `TELEGRAM_SHARED_CHANNEL_ID` are configured. Shared channel posts identify the business and link to a private customer chat with the bot. Customers can use that link without a website account; their conversation is scoped to that business. Linked users do not need to enter a bot token. Other owner bots retain their one-time code and legacy password flows. No password is stored in the app database. One Yes/No decision for a Content Plan item applies to its connected destinations; standalone scheduled posts keep separate decisions.

Deploy the updated Firestore rules alongside the app so linked users can see their own CRM inbox. Business owners require `/login` for private approvals. Customers can use a business chat link without signing in. Shared bot group messages remain disabled until the linked discussion group is configured. Existing Firestore documents are not migrated or removed. Expired, unused login-link records are cleared by the scheduled Telegram runner. Content Plan videos that fail speech checks remain in review and are not queued for any platform.

New Guest sign-in has been retired in both the website and the guest-token API. Existing local demo mode remains available.

1. Add `@dgacademy_official_bot` as a posting administrator of each linked account's saved channel. The linked
   Telegram user must also be a channel creator or posting administrator. The bot delivers approvals privately and
   publishes approved posts to that account's saved channel. As an optional fallback for accounts without a saved
   channel, add the bot to `@aimarketingengine` and set `TELEGRAM_SHARED_BOT_OWNER_UID` and
   `TELEGRAM_SHARED_CHANNEL_ID`. Accounts using separate bots can save their own token and channel.
2. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are not used as fallbacks for publishing. A post without a website
   owner, verified bot link or owner bot, and destination is blocked.
3. Set `TELEGRAM_ADMIN_CHAT_ID` to a private administrator chat/group to receive best-effort publishing and AI
   delivery failure alerts. Do not reuse the public `TELEGRAM_CHAT_ID` for internal alerts.
4. Register the webhook (`api/telegram/webhook.js`) with Telegram and set `TELEGRAM_WEBHOOK_SECRET`.
   Replies to comments in `@aimarketingengine` use the separate `@aime_angkorgate_bot`.
   Set `TELEGRAM_COMMENT_BOT_TOKEN` to that bot's token, `TELEGRAM_COMMENT_GROUP_ID`
   to the linked discussion group's ID, and a separate random
   `TELEGRAM_COMMENT_WEBHOOK_SECRET`. Register its webhook with
   `/api/telegram/webhook?action=set-webhook&bot=comments&key=<TELEGRAM_WEBHOOK_SETUP_KEY>`.
   The comment route accepts messages from that group only; it does not change the
   approval bot or the deployment-wide `TELEGRAM_BOT_TOKEN`.
5. Scheduled posts are delivered two ways: Upstash QStash for precise-time delivery, and a fallback poller
   (`.github/workflows/telegram-scheduler.yml`, every 10 minutes) that calls `/api/telegram/run-scheduled`.
   The GitHub Action uses a short-lived GitHub OIDC token restricted to this repository, main branch, and workflow;
   it no longer uses the GitHub `CRON_SECRET` repository secret. Confirm the Action is enabled and its jobs pass.
   Vercel's own cron entry for the same endpoint only runs once a day and is not sufficient on its own.

## Deployment to Vercel

1. Set all server secrets in the Vercel project's environment variables (not just locally in `.env`).
2. Build with `npm run build`.
3. Deploy — `vercel.json` handles cron scheduling and SPA rewrites; every file under `api/` is auto-deployed as a
   serverless function.
4. Confirm `APP_URL` matches the deployed domain (used to build TikTok/Telegram redirect and webhook URLs).
5. Keep `CRON_SECRET` in Vercel for its built-in cron requests. GitHub Actions uses the separate OIDC authentication
   in `.github/workflows/telegram-scheduler.yml`, so no matching GitHub repository secret is needed.
6. Download an application JSON backup from Security Center and keep it securely outside the app. Firestore
   point-in-time recovery and managed backups are optional paid safeguards; they are not enabled for this project.
7. Enable Firebase alerts for unusual Authentication activity and monitor Firestore rule denials; these events are
   not visible to the application when Firebase rejects them before request handling.

## Known Gaps

- Audit logging (`audit_logs`, admin-only read) covers key operational actions: Telegram replies, publish/cron
  actions, scheduler changes, Smart Reply rules, automation status, audience training, business-profile updates,
  and backup/restore. High-frequency AI chat autosaves are intentionally excluded.
- Admins can download and merge-restore a versioned JSON application backup in Security Center. Firebase
  point-in-time recovery and managed exports remain disabled by choice; the JSON backup has a narrower recovery scope.
- The local Express server mounts the production TikTok publish handler. Some older compatibility routes remain in
  `server.ts` and should not be used as the source of truth for production behavior.
- Ads Manager Lite generates AI strategy/creative/scaling guidance only; it does not connect to Meta or TikTok Ads
  accounts, so there is no automated bid/budget management.
