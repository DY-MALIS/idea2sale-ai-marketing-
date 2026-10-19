// Business Profile's "paste your website link" control: fetches a public
// webpage and reduces it to plain text for the same LLM summarization
// extractBusinessIntro already runs on an uploaded file -- see api/ai.js.
const MAX_WEBSITE_BYTES = 3 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 20000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

const typedError = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

// Best-effort SSRF guard: block the hostname forms used to reach a server's
// own internal network (loopback, link-local, the three private ranges)
// before ever issuing the fetch. Not a defense against DNS rebinding, but
// stops the obvious cases for a feature whose entire point is fetching a URL
// supplied by the end user.
const isBlockedHost = (hostname) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::' || host === '::1') return true;
  if (/^(?:fc|fd|fe[89ab])[0-9a-f]*:/.test(host)) return true;
  if (host.startsWith('::ffff:')) {
    const words = host.slice(7).split(':');
    if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
      const numeric = (parseInt(words[0], 16) * 65536) + parseInt(words[1], 16);
      return isBlockedHost([numeric >>> 24, (numeric >>> 16) & 255, (numeric >>> 8) & 255, numeric & 255].join('.'));
    }
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1, 3).map(Number);
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const checkedWebsiteUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw typedError('Enter a valid website link (starting with http:// or https://).', 'invalid_url');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw typedError('Only http/https website links are supported.', 'invalid_url');
  if (isBlockedHost(parsed.hostname)) throw typedError('This website link cannot be fetched.', 'blocked_host');
  return parsed;
};

const decodeHtmlEntities = (text) => text
  .replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&(?:#39|apos);/gi, "'");

export async function extractWebsiteText({ url }) {
  let parsed = checkedWebsiteUrl(url);
  let response;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    try {
      response = await fetch(parsed.toString(), {
        signal,
        // Check every Location before issuing another request. Automatic
        // redirects could otherwise bypass the private-host check above.
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; aime.angkorgate-bot/1.0; +https://aime.angkorgate.ai)' },
      });
    } catch {
      throw typedError('Could not reach this website. Check the link and try again.', 'fetch_failed');
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === MAX_REDIRECTS) throw typedError('This website redirected too many times.', 'too_many_redirects');
    const location = response.headers.get('location');
    if (!location) throw typedError('This website returned a redirect without a destination.', 'fetch_failed');
    let nextUrl;
    try { nextUrl = new URL(location, parsed); }
    catch { throw typedError('This website returned an invalid redirect destination.', 'invalid_url'); }
    parsed = checkedWebsiteUrl(nextUrl.toString());
  }
  if (!response.ok) throw typedError(`This website returned an error (status ${response.status}).`, 'fetch_failed');
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
    throw typedError('This link does not point to a readable web page.', 'unsupported_content_type');
  }

  const html = await response.text();
  if (html.length > MAX_WEBSITE_BYTES) throw typedError('This website page is too large to read.', 'page_too_large', 413);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const withoutNoise = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|p|div|li|h[1-6]|tr)\b[^>]*>/gi, '\n');
  const trimmed = decodeHtmlEntities(withoutNoise.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  if (!trimmed) throw typedError('No readable text was found on this page.', 'no_text_found');
  return { text: trimmed.slice(0, MAX_EXTRACTED_CHARS), title };
}
