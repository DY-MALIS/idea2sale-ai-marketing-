import { afterEach, expect, it, vi } from 'vitest';
import { extractWebsiteText } from '../../api/_websiteExtract.js';

afterEach(() => { vi.unstubAllGlobals(); });

const htmlResponse = (html, overrides = {}) => new Response(html, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  ...overrides,
});

it('rejects a link that is not http/https', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractWebsiteText({ url: 'ftp://example.com' })).rejects.toMatchObject({ code: 'invalid_url' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects an unparsable link', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractWebsiteText({ url: 'not a url' })).rejects.toMatchObject({ code: 'invalid_url' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  'http://localhost:3000/',
  'http://127.0.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://172.20.0.1/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fc00::1]/',
  'http://[fe80::1]/',
])('blocks a private/internal host before fetching it (%s)', async (url) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractWebsiteText({ url })).rejects.toMatchObject({ code: 'blocked_host' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('extracts readable text and the title from a real page, stripping scripts/styles/tags', async () => {
  const fetchMock = vi.fn(async () => htmlResponse(`
    <html><head><title>Sabai Coffee &amp; Roastery</title><style>body{color:red}</style></head>
    <body>
      <a href="/courses#details">Courses</a><a href="https://other.example.com/">Outside</a>
      <script>trackPageView();</script>
      <h1>Sabai Coffee</h1>
      <p>We roast and sell specialty coffee beans in Phnom Penh.</p>
      <p>Visit our shop on Street 240.</p>
    </body></html>
  `));
  vi.stubGlobal('fetch', fetchMock);
  const result = await extractWebsiteText({ url: 'https://sabaicoffee.example.com' });
  expect(result.title).toBe('Sabai Coffee & Roastery');
  expect(result.links).toEqual(['https://sabaicoffee.example.com/courses']);
  expect(result.text).toContain('We roast and sell specialty coffee beans in Phnom Penh.');
  expect(result.text).toContain('Visit our shop on Street 240.');
  expect(result.text).not.toContain('trackPageView');
  expect(result.text).not.toContain('color:red');
  expect(result.text).not.toMatch(/<[^>]+>/);
  expect(fetchMock.mock.calls[0][0]).toBe('https://sabaicoffee.example.com/');
});

it('rejects a non-HTML content type', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  await expect(extractWebsiteText({ url: 'https://example.com/data.json' })).rejects.toMatchObject({ code: 'unsupported_content_type' });
});

it('follows a public redirect only after validating its destination', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/about' } }))
    .mockResolvedValueOnce(htmlResponse('<html><body>Public business details.</body></html>'));
  vi.stubGlobal('fetch', fetchMock);
  const result = await extractWebsiteText({ url: 'https://example.com/' });
  expect(result.text).toContain('Public business details');
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://example.com/', 'https://example.com/about']);
  expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
});

it.each([
  'http://127.0.0.1/admin',
  'http://169.254.169.254/latest/meta-data/',
  'http://localhost:3000/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fc00::1]/',
])('never fetches a private redirect destination (%s)', async (destination) => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: destination } }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractWebsiteText({ url: 'https://example.com/' })).rejects.toMatchObject({ code: 'blocked_host' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('stops a redirect loop', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(extractWebsiteText({ url: 'https://example.com/' })).rejects.toMatchObject({ code: 'too_many_redirects' });
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it('rejects a non-2xx response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })));
  await expect(extractWebsiteText({ url: 'https://example.com/missing' })).rejects.toMatchObject({ code: 'fetch_failed' });
});

it('rejects when the connection itself fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); }));
  await expect(extractWebsiteText({ url: 'https://does-not-resolve.example.com' })).rejects.toMatchObject({ code: 'fetch_failed' });
});

it('rejects a page with no readable text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html><body><script>x()</script><style>.a{}</style></body></html>')));
  await expect(extractWebsiteText({ url: 'https://example.com/empty' })).rejects.toMatchObject({ code: 'no_text_found' });
});

it('reads public description metadata when a social Page has no server-rendered body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html><head><title>Example Cafe</title><meta property="og:description" content="Example Cafe. Coffee &amp; fresh food in Phnom Penh."></head><body><script>render()</script></body></html>')));
  const page = await extractWebsiteText({ url: 'https://www.facebook.com/example.cafe/' });
  expect(page.text).toBe('Example Cafe. Coffee & fresh food in Phnom Penh.');
  expect(page.metadataOnly).toBe(true);
});

it('rejects a page larger than the size limit', async () => {
  const huge = `<html><body>${'a'.repeat(3 * 1024 * 1024 + 1)}</body></html>`;
  vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(huge)));
  await expect(extractWebsiteText({ url: 'https://example.com/huge' })).rejects.toMatchObject({ code: 'page_too_large', status: 413 });
});
