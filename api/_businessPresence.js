import { generateOpenRouterWebSearch } from './_openrouter.js';
import { fetchPublicImage, fetchPublicPageIdentity, isPublicHttpUrl } from './_webBusinessSearch.js';
import { facebookBusinessPageKey, socialPlatformFromUrl, validLinkedInUrl } from './_socialUrls.js';
import sharp from 'sharp';

const cleanUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
};

const key = (value) => String(value || '').toLocaleLowerCase().normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const descriptionMatches = (description, pageText) => {
  const compactKhmer = (value) => String(value || '').match(/[\u1780-\u17ff]{8,}/gu) || [];
  if (compactKhmer(description).some((phrase) => compactKhmer(pageText).some((text) => text.includes(phrase.slice(0, 24))))) return true;
  const words = [...new Set(key(description).split(' ').filter((word) => word.length >= 5))];
  if (words.length < 2) return false;
  const haystack = key(pageText);
  return words.filter((word) => haystack.includes(word)).length >= Math.min(3, words.length);
};

const parseCandidates = (content) => {
  try {
    const json = JSON.parse(String(content || '').match(/\{[\s\S]*\}/)?.[0] || '{}');
    return Array.isArray(json.candidates) ? json.candidates.slice(0, 12) : [];
  } catch { return []; }
};

const socialCandidate = (url) => {
  if (facebookBusinessPageKey(url)) return 'Facebook';
  if (validLinkedInUrl(url)) return 'LinkedIn';
  return '';
};

const canonicalSocialUrl = (value) => {
  const url = cleanUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (facebookBusinessPageKey(url)) {
      return parts[0]?.toLowerCase() === 'pages'
        ? `https://www.facebook.com/pages/${parts[1]}/${parts[2]}/`
        : `https://www.facebook.com/${parts[0]}/`;
    }
    if (validLinkedInUrl(url)) return `https://www.linkedin.com/${parts[0]}/${parts[1]}/`;
  } catch { /* cleanUrl already checked this URL. */ }
  return '';
};

const publicName = (candidate, fallback) => String(candidate?.publicName || fallback || '').trim().slice(0, 120);

const logoMatches = async (profileLogo, page, { isSocialPage = false } = {}) => {
  const base64 = String(profileLogo || '').match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i)?.[1];
  const imageCandidates = Array.isArray(page?.imageCandidates) ? page.imageCandidates.filter((item) => !isSocialPage || (
    item.placement !== 'site icon' && (!['profile photo', 'page logo'].includes(item.placement) || item.ownerImage !== false)
  ))
    : (page?.imageUrls || []).map((url) => ({ url, placement: 'page image' }));
  if (!base64 || !imageCandidates.length) return { matched: false, strongMatch: false, checkedIdentityImage: false, placement: '' };
  let checkedIdentityImage = false;
  try {
    const normalized = async (buffer) => sharp(buffer).flatten({ background: '#ffffff' })
      .trim({ threshold: 10 }).resize(32, 32, { fit: 'contain', background: '#ffffff' })
      .removeAlpha().raw().toBuffer();
    const reference = await normalized(Buffer.from(base64, 'base64'));
    for (const candidateImage of imageCandidates.slice(0, 4)) {
      const image = await fetchPublicImage(candidateImage.url);
      if (!image) continue;
      const candidate = await normalized(image).catch(() => null);
      if (!candidate || candidate.length !== reference.length) continue;
      if (isSocialPage ? ['profile photo', 'page logo'].includes(candidateImage.placement) : candidateImage.placement === 'page logo') checkedIdentityImage = true;
      let difference = 0;
      let centerDifference = 0;
      let centerInk = 0;
      let centerVariation = 0;
      const centerMean = [0, 0, 0];
      for (let index = 0; index < reference.length; index += 1) difference += Math.abs(reference[index] - candidate[index]);
      for (let y = 8; y < 24; y += 1) {
        for (let x = 8; x < 24; x += 1) {
          const offset = (y * 32 + x) * 3;
          for (let channel = 0; channel < 3; channel += 1) {
            centerDifference += Math.abs(reference[offset + channel] - candidate[offset + channel]);
            centerInk += 255 - reference[offset + channel];
            centerMean[channel] += reference[offset + channel];
          }
        }
      }
      for (let y = 8; y < 24; y += 1) {
        for (let x = 8; x < 24; x += 1) {
          const offset = (y * 32 + x) * 3;
          for (let channel = 0; channel < 3; channel += 1) centerVariation += Math.abs(reference[offset + channel] - centerMean[channel] / 256);
        }
      }
      const fullDifference = difference / (reference.length * 255);
      const middleDifference = centerDifference / (16 * 16 * 3 * 255);
      const sameCrop = centerInk / (16 * 16 * 3 * 255) > 0.08 && middleDifference < 0.09;
      if (fullDifference < 0.12 || sameCrop) {
        const strongMatch = fullDifference < 0.08 || (sameCrop && middleDifference < 0.06 && centerVariation / (16 * 16 * 3 * 255) > 0.04);
        return { matched: true, strongMatch, checkedIdentityImage, placement: candidateImage.placement };
      }
    }
  } catch { /* Invalid or unsupported profile image. */ }
  return { matched: false, strongMatch: false, checkedIdentityImage, placement: '' };
};

// Discover the owner's own public presence independently of lead/competitor
// research. A URL returned by search is only a candidate; first-party website
// content and links decide which identities can be shown as corroborated.
export async function findBusinessPresence({ businessName, businessDescription = '', logoDataUrl = '', facebookPageUrl = '', country = 'Cambodia' }) {
  const name = String(businessName || '').trim().slice(0, 120);
  if (!name) return { businessName: '', matches: [], candidates: [] };
  const savedFacebook = cleanUrl(facebookPageUrl);
  const savedFacebookKey = facebookBusinessPageKey(savedFacebook);
  const searchRequest = {
    system: 'Find public website and business social Page candidates for the Business Profile. Return only JSON. A genuinely matching logo is enough to include a candidate even if its public name or introduction differs. Similar-looking but different logos and unrelated same-name businesses must stay separate. Do not require company registration.',
    prompt: `Business Profile name: ${name}\nOwner introduction: ${String(businessDescription).slice(0, 800) || 'not provided'}\nOwner-provided Facebook Page: ${savedFacebookKey ? savedFacebook : 'not provided'}\nCountry: ${country}. Search for the business's website, Facebook Page and LinkedIn company Page, including alternate names. The attached image, if any, is the owner's logo: include direct Pages/sites that display the same logo even when their names and descriptions differ. Return JSON {"candidates":[{"url":"https://...","publicName":"name on page","evidence":"short search-result reason"}]}. Include up to 12 distinct direct Pages/sites, not directories, posts, personal profiles, or competitors. Do not invent URLs.`,
    imageDataUrl: logoDataUrl,
    maxResults: 12,
    maxTokens: 4000,
    timeoutMs: 35_000,
  };
  let result;
  try {
    result = await generateOpenRouterWebSearch(searchRequest);
  } catch (error) {
    if (logoDataUrl) {
      result = await generateOpenRouterWebSearch({ ...searchRequest, imageDataUrl: '' }).catch(() => ({ content: '' }));
    } else {
      result = { content: '' };
    }
  }
  const candidates = parseCandidates(result.content);
  if (savedFacebookKey && !candidates.some((candidate) => facebookBusinessPageKey(candidate?.url) === savedFacebookKey)) {
    candidates.unshift({ url: savedFacebook, publicName: name, evidence: 'Saved in Business Profile' });
  }

  const websites = [];
  const socials = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const url = cleanUrl(candidate?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const platform = socialCandidate(url);
    if (platform) socials.push({ url: canonicalSocialUrl(url), platform, publicName: publicName(candidate, name), evidence: String(candidate?.evidence || '').slice(0, 240) });
    else if (socialPlatformFromUrl(url) === 'Web' && await isPublicHttpUrl(url)) websites.push({ url, publicName: publicName(candidate, name) });
  }

  const matches = [];
  const possible = [];
  const confirmedSocialKeys = new Set();
  await Promise.all(websites.slice(0, 10).map(async (website) => {
    const page = await fetchPublicPageIdentity(website.url);
    if (!page) return;
    const pageName = key(`${page.title} ${page.description}`);
    const nameMatch = !!key(name) && pageName.includes(key(name));
    const introMatch = descriptionMatches(businessDescription, `${page.description} ${page.text}`);
    const linkedSavedPage = !!savedFacebookKey && page.links.some((link) => facebookBusinessPageKey(link) === savedFacebookKey);
    const logo = await logoMatches(logoDataUrl, page);
    const evidence = [nameMatch && 'Business name on site', introMatch && 'Introduction matches site', logo.matched && `Logo matches Business Profile (${logo.placement})`, linkedSavedPage && 'Site links to profile Facebook Page'].filter(Boolean);
    if (logoDataUrl && logo.checkedIdentityImage && !logo.matched) evidence.push('Site identity image could not be matched to profile logo');
    const item = { platform: 'Website', url: page.url, publicName: page.title || website.publicName, evidence };
    if (!logo.checkedIdentityImage || logo.matched) {
      if (logo.strongMatch || linkedSavedPage || (introMatch && (nameMatch || logo.matched))) {
        matches.push(item);
        for (const link of page.links) {
          const platform = socialCandidate(link);
          if (!platform) continue;
          const socialKey = platform === 'Facebook' ? facebookBusinessPageKey(link) : canonicalSocialUrl(link);
          confirmedSocialKeys.add(socialKey);
          socials.push({ url: canonicalSocialUrl(link), platform, publicName: website.publicName, evidence: 'Linked from matching business website', sourceUrl: page.url });
        }
      } else if (nameMatch || introMatch || logo.matched) possible.push(item);
    } else if (nameMatch || introMatch || linkedSavedPage) possible.push(item);
  }));

  const socialByIdentity = new Map();
  for (const social of socials) {
    const identity = social.platform === 'Facebook' ? facebookBusinessPageKey(social.url) : social.url;
    if (!identity) continue;
    if (!socialByIdentity.has(identity) || social.sourceUrl) socialByIdentity.set(identity, social);
  }
  const uniqueSocials = [...socialByIdentity.values()];
  await Promise.all(uniqueSocials.slice(0, 12).map(async (social) => {
    const identity = social.platform === 'Facebook' ? facebookBusinessPageKey(social.url) : social.url;
    let confirmed = confirmedSocialKeys.has(identity);
    let directEvidence = [];
    let logoInspectionUnavailable = !!logoDataUrl;
    const page = await fetchPublicPageIdentity(social.url);
    if (page) {
        const nameMatch = key(`${page.title} ${page.description}`).includes(key(name));
        const introMatch = descriptionMatches(businessDescription, `${page.description} ${page.text}`);
        const logo = await logoMatches(logoDataUrl, page, { isSocialPage: true });
        logoInspectionUnavailable = !!logoDataUrl && !logo.matched && !logo.checkedIdentityImage;
        if (logoDataUrl && logo.checkedIdentityImage && !logo.matched) confirmed = false;
        else confirmed = confirmed || logo.strongMatch || (introMatch && (logo.matched || (nameMatch && !logoDataUrl)));
        directEvidence = [nameMatch && 'Business name on Page', introMatch && 'Introduction matches Page', logo.matched && `Logo matches Business Profile (${logo.placement})`, logoDataUrl && logo.checkedIdentityImage && !logo.matched && 'Page identity image could not be matched to profile logo'].filter(Boolean);
    }
    const item = {
      platform: social.platform,
      url: social.url,
      publicName: social.publicName,
      evidence: [
        ...(confirmed && social.sourceUrl ? ['Linked from matching business website'] : []),
        ...directEvidence,
        ...(logoInspectionUnavailable ? ['Page logo not publicly available for comparison'] : []),
        ...(!confirmed && !directEvidence.length ? [identity === savedFacebookKey ? 'Saved in Business Profile' : 'Found in web search'] : []),
      ],
      ...(social.sourceUrl ? { sourceUrl: social.sourceUrl } : {}),
    };
    (confirmed ? matches : possible).push(item);
  }));
  return { businessName: name, matches: matches.slice(0, 12), candidates: possible.slice(0, 12) };
}
