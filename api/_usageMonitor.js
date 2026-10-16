import { notifyAdmins } from './_alert.js';
import { synthesizeKhmerSpeechViaEdge } from './_edgeSpeech.js';

// Both OpenRouter and ImageKit have already silently blocked real generation
// jobs once each (Sep 2026) with no warning before the hard stop -- OpenRouter's
// per-key spend limit and ImageKit's monthly video-transformation quota. This
// proactively checks both and pages the admin chat before that happens again.
const OPENROUTER_MIN_REMAINING_USD = 15;

// ImageKit's usage API reports raw counts, not the plan's cap -- there is no
// field to compute an exact percentage from. 515 units was already over the
// free-tier cap (observed 2026-09-29), so this warns well before that as a
// practical safety margin. Raise this if the ImageKit plan is upgraded.
const IMAGEKIT_VIDEO_UNITS_WARN_THRESHOLD = 400;

const checkOpenRouterCredits = async () => {
  const key = (process.env.OPEN_ROUTER_API_KEY || '').trim();
  if (!key) return null;
  const response = await fetch('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.data) throw new Error(`OpenRouter credits check failed: HTTP ${response.status}`);
  const { total_credits: totalCredits, total_usage: totalUsage } = data.data;
  const remaining = Number(totalCredits) - Number(totalUsage);
  if (Number.isFinite(remaining) && remaining < OPENROUTER_MIN_REMAINING_USD) {
    return `OpenRouter credit is low: $${remaining.toFixed(2)} remaining (of $${Number(totalCredits).toFixed(2)} total). Top up at https://openrouter.ai/settings/credits before video/image generation starts failing.`;
  }
  return null;
};

const checkImageKitVideoUnits = async () => {
  const privateKey = (process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
  if (!privateKey) return null;
  const now = new Date();
  const startDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const endDate = now.toISOString().slice(0, 10);
  const auth = Buffer.from(`${privateKey}:`).toString('base64');
  const response = await fetch(
    `https://api.imagekit.io/v1/accounts/usage?startDate=${startDate}&endDate=${endDate}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ImageKit usage check failed: HTTP ${response.status}`);
  const units = Number(data?.videoProcessingUnitsCount);
  if (Number.isFinite(units) && units >= IMAGEKIT_VIDEO_UNITS_WARN_THRESHOLD) {
    return `ImageKit video processing usage is high: ${units} units this month (warn threshold ${IMAGEKIT_VIDEO_UNITS_WARN_THRESHOLD}). Check https://imagekit.io/dashboard before video playback/delivery starts failing with "Video transformations limit exceeded".`;
  }
  return null;
};

// Edge TTS is an unofficial, reverse-engineered client for Microsoft's
// internal Read Aloud service (see api/_edgeSpeech.js) -- it has already
// broken once in production (Oct 2026) when Microsoft retired the endpoint
// it connected to, and every Khmer video silently fell back to a slower,
// less reliable path (or failed outright) until that was diagnosed and the
// library upgraded. This catches the next occurrence within hours instead
// of waiting for a user to report a failed video. Free to run (no paid API
// call), so unlike the two checks above this isn't a quota threshold --
// synthesis either works or it doesn't.
const checkKhmerVoiceHealth = async () => {
  try {
    await synthesizeKhmerSpeechViaEdge({ input: 'សួស្តី', voice: 'km-KH-SreymomNeural', rate: '+0%' });
    return null;
  } catch (error) {
    return `Khmer voice (Edge TTS) is failing: ${error?.message || error}. This has happened before when Microsoft changed the unofficial endpoint node-edge-tts connects to -- check https://github.com/SchneeHertz/node-edge-tts for a newer version and "npm install node-edge-tts@latest" if one fixes it. Video narration still has a Gemini fallback, but confirm that is not also degraded.`;
  }
};

// Runs all checks and pages the admin chat for any that failed or are close
// to their limit. Each check is independent and best-effort -- one check
// failing (e.g. a transient network error) must not skip the others.
export async function runUsageChecks() {
  const results = await Promise.allSettled([checkOpenRouterCredits(), checkImageKitVideoUnits(), checkKhmerVoiceHealth()]);
  const warnings = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) warnings.push(result.value);
    else if (result.status === 'rejected') console.error('[usage-monitor]', result.reason?.message || result.reason);
  }
  for (const warning of warnings) {
    await notifyAdmins(warning);
  }
  return { warnings };
}
