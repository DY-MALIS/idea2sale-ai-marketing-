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

export const applyImageKitDeliveryTransform = (mediaUrl, mediaType, urlEndpoint = '') => {
  const transform = mediaType === 'video' ? 'w-1280,q-auto,f-mp4' : 'w-1280,q-auto,f-auto';
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
