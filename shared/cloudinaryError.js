const CLOUDINARY_CREDENTIAL_ERROR = /(?:invalid|unknown)\s+api[_ -]?key|api[_ -]?secret\s+mismatch|invalid\s+signature|authentication\s+(?:failed|required)/i;
const ECHOED_API_KEY = /(\bapi[_ -]?key\b\s*(?:[:=]|is)?\s*)[A-Za-z0-9_-]{6,}/gi;

/**
 * Cloudinary sometimes echoes the submitted API key in an upload error. The
 * browser performs signed uploads directly, so provider messages must be
 * cleaned before they are shown in a toast or returned by an API route.
 */
export const formatCloudinaryUploadError = (message, apiKey = '') => {
  const raw = String(message || '').trim();
  let redacted = raw;

  if (apiKey) {
    redacted = redacted.split(String(apiKey)).join('[redacted]');
  }
  redacted = redacted.replace(ECHOED_API_KEY, '$1[redacted]');

  if (CLOUDINARY_CREDENTIAL_ERROR.test(raw)) {
    return 'Cloudinary media storage credentials are invalid. Update the Cloudinary settings in Vercel and redeploy.';
  }

  return redacted || 'Cloudinary upload failed.';
};
