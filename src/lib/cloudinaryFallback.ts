const isQuotaError = (status: number, message: string) => status === 402
  || /(?:storage|bandwidth|video (?:processing )?units|quota|allowance).{0,80}(?:limit|exceed|exhaust|full)|(?:limit|exceed|exhaust|full).{0,80}(?:storage|bandwidth|video (?:processing )?units|quota|allowance)/i.test(message);

/** Retry a rejected ImageKit upload only when its response identifies exhausted allowance. */
export async function uploadCloudinaryFallback(
  file: File,
  idToken: string,
  status: number,
  message: string,
): Promise<string | null> {
  if (!isQuotaError(status, message)) return null;
  const signedResponse = await fetch('/api/telegram/run-scheduled?action=sign-upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'cloudinary', fileName: file.name, contentType: file.type }),
  });
  if (!signedResponse.ok) return null; // Fallback is not configured or enabled.
  const signed = await signedResponse.json().catch(() => ({}));
  if (!signed.ok || signed.provider !== 'cloudinary' || file.size > Number(signed.maxBytes)) return null;
  const form = new FormData();
  form.set('file', file);
  form.set('api_key', String(signed.apiKey));
  form.set('timestamp', String(signed.timestamp));
  form.set('signature', String(signed.signature));
  form.set('folder', String(signed.cloudinaryFolder));
  const response = await fetch(signed.uploadUrl, { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !/^https:\/\/res\.cloudinary\.com\//.test(String(result.secure_url || ''))) {
    throw new Error(`ImageKit storage is full and Cloudinary upload failed (HTTP ${response.status}).`);
  }
  return String(result.secure_url);
}
