export function telegramRetryPlan(post, failure, nowMs = Date.now()) {
  const prior = Number(post?.retryCount) || 0;
  if (!failure?.retrySafe || failure.permanent || prior >= 4) return null;
  const delayMs = Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** prior);
  return { retryCount: prior + 1, nextAttemptAt: new Date(nowMs + delayMs).toISOString() };
}
