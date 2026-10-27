# Google OAuth data access review — YouTube upload

Google Cloud project shown in the owner's screenshots: **Default Gemini Project**. The YouTube OAuth Client ID displayed there matches the locally configured client ID. Audience is **External / In production**. Branding is verified. Data access for `https://www.googleapis.com/auth/youtube.upload` is **not verified**.

## Scope justification — paste into Google Cloud

> Aime is a marketing content scheduler used by separate businesses. Each signed-in user can choose to connect a YouTube channel through Google's OAuth consent flow. After the user selects a video, enters or edits its title and description, and chooses a publication time, Aime uses the `youtube.upload` scope to upload that user-selected video to the connected channel via the YouTube Data API `videos.insert` method. The app displays the connected channel and the upload result in the user's workspace. OAuth tokens are stored on the server under that signed-in user's account and are not shared with other customers. We request `youtube.upload` because video upload is necessary for this user-initiated scheduling feature. Read-only scopes cannot upload a video, and we do not request broader YouTube permissions.

## Demo video required by Google

Record the **actual deployed app** in a browser. Show, in one recording:

1. The app name and homepage, then sign in and open Smart Scheduler.
2. Select YouTube and click Connect YouTube.
3. The complete Google consent screen in English, including the requested YouTube permission, and the user's approval. Hide passwords and codes.
4. The connected channel in Aime.
5. Select an authorized sample video, set its title/description and scheduled time, then show the upload result in Content Timeline and the resulting video in YouTube Studio.

Upload the recording to an accessible YouTube or Google Drive link and enter that **link** in Google's **Video link** field. A local MP4 path is not a reviewable link. Do not submit a simulated or edited consent flow.

## Remaining checks before submission

- In **Prepare for verification → Data access summary → Fix the issue**, enter the justification above and the real demo video link. The screenshot shows both fields missing.
- Confirm the public homepage, privacy policy, and terms links entered in Branding load for a signed-out reviewer. The repo has these pages; live availability has not been independently confirmed from this environment.
- Google's domain review may require a Search Console **Domain property** for `angkorgate.ai`, verified by a Google Cloud project owner. On October 26, 2026, the root-domain Google verification TXT record was visible from the authoritative server (`ns1.dyna-ns.net`) and public resolvers (`1.1.1.1`, `8.8.8.8`). DNS visibility alone does not confirm that the project owner clicked **Verify** for the Domain property in Search Console or that Google OAuth data access review was approved. The known `https://aime.angkorgate.ai/` URL-prefix property does not prove root-domain ownership for this review.
- After the form is complete, submit it for review and respond to any Google reviewer email. Approval is granted by Google, not by changing the app code.

Official references: [OAuth verification](https://support.google.com/cloud/answer/13461325?hl=en), [demo video](https://support.google.com/cloud/answer/13804565?hl=en), [domain verification](https://support.google.com/cloud/answer/13804266?hl=en).
