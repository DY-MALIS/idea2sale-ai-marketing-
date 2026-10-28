# Google OAuth data access review — YouTube upload

Google Cloud project shown in the owner's screenshots: **Default Gemini Project**. The YouTube OAuth Client ID displayed there matches the locally configured client ID. Audience is **External / In production**. Branding is verified. Data access for `https://www.googleapis.com/auth/youtube.upload` is **not verified**.

## Scope justification — paste into Google Cloud

> Aime is a marketing content scheduler used by separate businesses. Each signed-in user can choose to connect a YouTube channel through Google's OAuth consent flow. After the user selects a video, enters or edits its title and description, and chooses a publication time, Aime uses the `youtube.upload` scope to upload that user-selected video to the connected channel via the YouTube Data API `videos.insert` method. The app displays the connected channel and the upload result in the user's workspace. OAuth tokens are stored on the server under that signed-in user's account and are not shared with other customers. We request `youtube.upload` because video upload is necessary for this user-initiated scheduling feature. Read-only scopes cannot upload a video, and we do not request broader YouTube permissions.

## Demo video required by Google

Record the **actual deployed app** in a browser. Make the demo clearly show the end-to-end flow:

1. The app name and homepage, then sign in and open Smart Scheduler.
2. Select YouTube and click Connect YouTube.
3. The complete Google consent screen in English, including the requested YouTube permission, and the user's approval. Hide passwords and codes.
4. The connected channel in Aime.
5. Select an authorized sample video, set its title/description and scheduled time, then show the upload result in Content Timeline and the resulting video in YouTube Studio.

Upload the recording to YouTube as **Unlisted** and enter its `https://youtube.com/...` or `https://youtu.be/...` URL in Google's **YouTube link** field. The current Google Auth Platform form rejects Google Drive links for this field. A local MP4 path is not a reviewable link. Google's OAuth demo guidance allows video editing to clarify the demonstration; keep the real consent screen, grant, and app actions accurate and legible.

### Captured evidence (October 27, 2026)

The deployed app scheduled `gemini_generated_video_0c04c9ff.mp4` for YouTube at 2:30 PM. Content Timeline showed **Uploaded**, visibility **public**, and channel **Dy Malis**. The resulting video opened at https://www.youtube.com/watch?v=gE0VrvMKzBU.

The local file `artifacts/youtube-oauth-review-with-real-schedule-2026-10-27.mp4` combines a real OAuth screen recording with English Google consent and the owner's later recording of a successful 2:43 PM scheduled upload. The later recording shows the Schedule action, Pending, Uploaded, and the resulting YouTube watch page. This is an edited composite of real sessions, with audio removed. A copy was uploaded to Google Drive on October 27, 2026, but remains restricted to the owner and cannot be entered in the current YouTube-only verification field. The owner uploaded the composite to YouTube as **Unlisted**: https://youtu.be/onbyd-GcD2o. Google Cloud saved this link and the scope justification in Data Access on October 27, 2026.

## Submission checks

- The scope justification and accessible **YouTube link** were entered and saved in Data Access.
- The public homepage and privacy policy were checked in a browser. Google already showed the app's branding as verified. If Trust and Safety requests additional domain evidence, a project owner may need to verify the Search Console **Domain property** for `angkorgate.ai`. On October 26, 2026, the root-domain verification TXT record was visible in DNS, but DNS visibility alone does not confirm Search Console Domain property verification. The known `https://aime.angkorgate.ai/` URL-prefix property does not prove root-domain ownership.
- The form was submitted on October 27, 2026. Respond to any Google reviewer email. Approval is granted by Google, not by changing the app code.

### October 27 submission status

On October 27, 2026, commit `740e2e9bb2e88ebda2bf08d0031178b5ccd4b50f` deployed to Vercel production and was aliased to `aime.angkorgate.ai`. The live privacy policy was checked in a browser and explicitly describes YouTube API Services, `youtube.upload`, stored tokens, scheduled uploads, revocation, deletion requests, and Google API Services User Data Policy Limited Use. The Google form contained the scope justification, the Unlisted demo link, and reviewer instructions. Its four app-use questions were answered **No**. After the owner's explicit authorization, the two acknowledgements were checked and **Submit for verification** was clicked.

Google Verification Center now says **“Your app's data access is under review.”** Its progress panel says the Trust and Safety team received the form and will contact `dymalis88@gmail.com` if needed. It estimates the first email in 3–5 days and the review in up to 4–6 weeks. This is submission, not Google approval; the app may still show an unverified warning during review. Watch the contact inbox and answer any reviewer requests.

Official references: [OAuth verification](https://support.google.com/cloud/answer/13461325?hl=en), [demo video](https://support.google.com/cloud/answer/13804565?hl=en), [domain verification](https://support.google.com/cloud/answer/13804266?hl=en).
