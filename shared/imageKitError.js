const IMAGEKIT_CREDENTIAL_ERROR = /(?:invalid|missing|unauthori[sz]ed|forbidden).*(?:key|credential)|(?:key|credential).*(?:invalid|missing|unauthori[sz]ed|forbidden)/i;

/** Keep provider responses useful without echoing configured credentials. */
export const formatImageKitUploadError = (message, credentials = []) => {
  const raw = String(message || '').trim();
  let redacted = raw;
  for (const credential of credentials) {
    if (credential) redacted = redacted.split(String(credential)).join('[redacted]');
  }
  redacted = redacted
    .replace(/\bprivate_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bpublic_[A-Za-z0-9_-]+/g, '[redacted]');

  if (IMAGEKIT_CREDENTIAL_ERROR.test(raw)) {
    return 'ImageKit media storage credentials are invalid. Update the ImageKit settings in Vercel and redeploy.';
  }
  return redacted || 'ImageKit upload failed.';
};
