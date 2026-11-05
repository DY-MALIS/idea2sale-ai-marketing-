# Facebook App Review demo

The poster `facebook-review-demo.png` is a proposed public test post, not evidence that a post was published. It is paired with this caption:

> Aime Page Publisher review demo. This post was scheduled from the app to verify the Facebook Page connection and publishing flow.

The owner selected **Daily Food** and authorized the public test post with this exact poster and caption. Record the real production browser flow: Facebook Login for Business with the existing owner account, Page selection, poster and caption selection, schedule, delivery status, and the resulting post on the same Page. Keep tokens, OTPs, and personal account settings out of the video. Use one real recording for the three Page-permission upload fields if Meta accepts that format.

The active Facebook OAuth page currently offers to continue as Ma Lis with the previously connected Aime Page Publisher settings. Continuing renews persistent app access. The owner confirmed this action and the Daily Food test post. On 2026-10-30, the actual click was **blocked before execution**: automatic approval review reported that the workspace was out of credits. No consent was accepted, no new post was scheduled or published, and no review video was uploaded. Do not bypass that review check. Resume from the live OAuth screen when the workspace credits/approval service are restored.

## Data handling evidence

The Meta form identifies **DGAcademy, Cambodia** as controller and the owner previously answered **No** to national-security disclosure in the past 12 months and selected **None of the above** for formal request handling processes. The processor answer is **Yes**, with no entries saved yet.

Source inspection identifies these direct processors of Meta Platform Data:

| Provider | Meta data handled | Evidence | Country status |
| --- | --- | --- | --- |
| Vercel | API functions exchange tokens and make Graph API calls | `api/_facebook.js`, production `iad1` | Primary function region is United States; all remote access countries unconfirmed |
| Google Firebase / Google Cloud | Firestore stores Page IDs, names, and Page access tokens | `api/_facebook.js` `saveFacebookPages` | Firestore `us-west1` in United States; all remote access countries unconfirmed |
| OpenRouter | AI Agent can send connected Page details and recent posts in model prompts | `api/ai.js` `readProfileFacebookPage` and `api/_openrouter.js` | Model routing and processing countries unconfirmed |

Upstash QStash receives an internal scheduled post ID for Facebook delivery, not the Page token or Graph payload (`api/_facebook.js` `scheduleFacebookQStashDelivery`). ImageKit and Cloudinary receive user-uploaded media, not data obtained from Meta in this flow. Recheck these boundaries if production code differs.

Meta's processor form requires every processor's service categories and **all** countries where it processes or remotely accesses Meta data. Do not save a US-only answer as complete: [Vercel's DPA](https://vercel.com/legal/dpa) and [Google Cloud's DPA](https://cloud.google.com/terms/data-processing-addendum) both permit processing outside the primary US region. The business owner or providers must confirm the complete country list and whether OpenRouter sends Page data to downstream model providers before the declaration can be truthful.

The owner said they use Vercel from Cambodia. That establishes the owner's location, not all countries where Vercel processes or remotely accesses Meta data.
