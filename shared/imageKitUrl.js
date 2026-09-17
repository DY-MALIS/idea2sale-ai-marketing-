const matchesImageKitEndpoint = (url, urlEndpoint = '') => {
  if (url.hostname === 'ik.imagekit.io' || url.hostname.endsWith('.imagekit.io')) return true;
  try {
    const configured = new URL(String(urlEndpoint || ''));
    const configuredPath = configured.pathname.replace(/\/$/, '');
    return url.hostname === configured.hostname
      && (!configuredPath || url.pathname === configuredPath || url.pathname.startsWith(`${configuredPath}/`));
  } catch {
    return false;
  }
};

export const addImageKitTransform = (mediaUrl, transform, urlEndpoint = '') => {
  if (!mediaUrl) return '';
  let url;
  try {
    url = new URL(mediaUrl);
  } catch {
    return mediaUrl;
  }
  if (!matchesImageKitEndpoint(url, urlEndpoint)) return mediaUrl;
  const steps = (url.searchParams.get('tr') || '').split(':').filter(Boolean);
  if (!steps.includes(transform)) steps.push(transform);
  url.searchParams.set('tr', steps.join(':'));
  return url.toString();
};

// ImageKit accepts numeric video quality values (for example q-70), but not
// q-auto. Older generated-video URLs used q-auto and therefore return HTTP 400
// instead of playable media. Repair those persisted URLs at read time too, so
// users do not lose access to videos that were already generated and paid for.
export const normalizeImageKitVideoUrl = (mediaUrl, urlEndpoint = '') => {
  if (!mediaUrl) return '';
  let url;
  try {
    url = new URL(mediaUrl);
  } catch {
    return mediaUrl;
  }
  if (!matchesImageKitEndpoint(url, urlEndpoint)) return mediaUrl;
  const transform = url.searchParams.get('tr');
  if (!transform || !/(^|[:,])q-auto(?=[:,]|$)/.test(transform)) return mediaUrl;
  url.searchParams.set('tr', transform.replace(/(^|[:,])q-auto(?=[:,]|$)/g, '$1q-70'));
  return url.toString();
};

export const getOriginalImageKitUrl = (mediaUrl, urlEndpoint = '') => {
  if (!mediaUrl) return '';
  let url;
  try {
    url = new URL(mediaUrl);
  } catch {
    return mediaUrl;
  }
  if (!matchesImageKitEndpoint(url, urlEndpoint) || !url.searchParams.has('tr')) return mediaUrl;
  url.searchParams.delete('tr');
  return url.toString();
};

export const applyImageKitDeliveryTransform = (mediaUrl, mediaType, urlEndpoint = '') => {
  // Width, image-quality and image-format transforms do not apply to MP3/WAV
  // assets. Adding them made narration URLs return a transformation error,
  // leaving audio-reference video jobs without a usable speech track.
  if (mediaType === 'audio') return mediaUrl;
  const transform = mediaType === 'video' ? 'w-1280,q-70,f-mp4' : 'w-1280,q-auto,f-auto';
  return addImageKitTransform(mediaUrl, transform, urlEndpoint);
};

export const applyImageKitMuteTransform = (mediaUrl, urlEndpoint = '') =>
  addImageKitTransform(mediaUrl, 'ac-none', urlEndpoint);

export const applyImageKitAudioExtractionTransform = (mediaUrl, urlEndpoint = '') =>
  addImageKitTransform(mediaUrl, 'vc-none,ac-aac,f-mp4', urlEndpoint);

export const applyImageKitLogoOverlay = (videoUrl, logoFilePath, urlEndpoint = '') => {
  const layerPath = String(logoFilePath || '').replace(/^\/+/, '').replaceAll('/', '@@');
  if (!layerPath || !/^[A-Za-z0-9@._-]+$/.test(layerPath)) return videoUrl;
  return addImageKitTransform(
    videoUrl,
    `l-image,i-${layerPath},w-bw_mul_0.16,lfo-bottom_left,lx-20,ly-20,l-end`,
    urlEndpoint,
  );
};
