// A Khmer video spends time and money on speech and a presenter image before
// submitting the video. Check a known exhausted account first so all video
// entry points fail promptly with the actual cause. This is best effort: a
// temporary credits-API outage must not become a new generation outage.
export async function assertVideoCreditAvailable() {
  const key = (process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
  if (!key) return;

  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return;
    const credits = (await response.json())?.data;
    if (credits?.total_credits == null || credits?.total_usage == null) return;
    const remaining = Number(credits.total_credits) - Number(credits.total_usage);
    if (Number.isFinite(remaining) && remaining <= 0) {
      throw Object.assign(
        new Error('OpenRouter credits are exhausted. Add credit at https://openrouter.ai/settings/credits before generating a video.'),
        { statusCode: 402, videoStartNotSubmitted: true },
      );
    }
  } catch (error) {
    if (error?.statusCode === 402) throw error;
    console.warn('Could not check OpenRouter credits before video generation:', error?.message || error);
  }
}
