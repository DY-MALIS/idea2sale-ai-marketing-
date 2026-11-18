// Some video providers return a privacy code, while others only put the
// reason in a 400 message such as "input image 'content[1]' may contain real
// person". Both represent the same rejected reference-image request.
export const isVideoImagePrivacyRejection = (error) => {
  const detail = `${error?.providerCode || ''} ${error?.message || ''}`;
  if (/InputImageSensitiveContentDetected/i.test(detail)) return true;
  return error?.statusCode === 400
    && /\b(?:input|starting|reference|uploaded)\s+image\b.{0,120}\bmay contain\s+(?:a\s+)?(?:real|identifiable)\s+person\b/i.test(detail);
};
