# Google OAuth review: YouTube upload

Project: `gen-lang-client-0798968662`  
App: `aime.angkorgate`  
Requested scope: `https://www.googleapis.com/auth/youtube.upload`

## Scope justification draft

An Aime user signs in, opens Smart Scheduler, selects YouTube, and connects their own Google account through OAuth. They choose a video, enter or edit its caption, and choose a publication time. The app uses `youtube.upload` to upload that selected video to the connected account's YouTube channel at the chosen time through the YouTube Data API `videos.insert` endpoint. The app then displays the upload result and a link to the video in Content Timeline. Each connection is stored under the signed-in Aime user's account, so one business cannot use another business's YouTube connection. We request this scope because scheduled video upload is the feature the user has explicitly selected. Read-only YouTube scopes cannot upload a video, and broader YouTube permissions are unnecessary for this feature.

Review this wording against the deployed app before submitting it to Google.

## Demo video to record

Record the **Edge browser window**, with the Aime and Google pages visible. Do not record the VS Code window.

1. In Aime, sign in and open **Smart Scheduler → Schedule**.
2. Select **YouTube** and click **Connect YouTube** or **Change channel**.
3. Show the Google account picker and the complete consent screen requesting YouTube video management, with the consent screen language set to **English**.
4. Return to Aime and show the connected YouTube state.
5. Choose a video, enter a caption, select a publication time, and show the upload result in **Content Timeline**. Use content that the account owner has authorized for this demonstration. The recording should show the same Aime app name and branding as the submitted OAuth app.

Before sharing the recording, review it for personal details, passwords, verification codes, and unrelated tabs. Google Cloud's Data Access form requires a video **link**, not a local MP4 path.

## Current blockers

- Google Cloud shows **Branding verified** and **Data access not verified**. The Data Access form requires both a scope justification and a demo video link.
- Google Cloud Audience shows **External**, **In production**, and **1 user / 100 user cap** as of 2026-10-23. Unverified users can encounter Google's warning and the lifetime cap; this is not a general release for businesses.
- The recording `Recording 2026-10-22 145702.mp4` shows VS Code throughout; it cannot demonstrate the OAuth and upload flow.
- Google requires ownership of the **Domain property** `angkorgate.ai` in Search Console for OAuth domain verification. A URL-prefix property is insufficient. The pending DNS TXT record is `google-site-verification=qH-I58KrIXsXr1KXwxKpm4Qhgx2nVreJ6dVbhNz_Aug` at the root (`@`). The authoritative name servers currently shown are `ns1.dyna-ns.net` and `ns2.dyna-ns.net`, consistent with Dynadot DNS. The domain account owner must add this under Dynadot's **Domain Record → TXT** and save it; Dynadot says to leave out the literal `@`.
- Browser automation for the Google OAuth consent flow was rejected by automatic approval review because the workspace was out of credits. Do not repeat that blocked action until the workspace owner restores credits.

Official guidance: [Demo video](https://support.google.com/cloud/answer/13804565?hl=en), [Domain verification](https://support.google.com/cloud/answer/13804266?hl=en), [Dynadot TXT setup](https://www.dynadot.com/help/question/create-TXT-record), [OAuth audience and cap](https://support.google.com/cloud/answer/15549945?hl=en).
