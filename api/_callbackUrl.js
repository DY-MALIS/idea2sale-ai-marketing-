export function getScheduledCallbackBaseUrl() {
  const configured = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('APP_URL must be configured to schedule delivery callbacks.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('APP_URL must be a public HTTPS origin to schedule delivery callbacks.');
  }
  return url.origin;
}
