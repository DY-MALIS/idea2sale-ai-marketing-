import { expect, it, vi } from 'vitest';
import { readConnectedFacebookPage, readProfileFacebookPage } from '../../api/_facebook.js';

it('reads only the signed-in owner selected Facebook Page and returns no token', async () => {
  const get = vi.fn().mockResolvedValue({ exists: true, data: () => ({
    ownerId: 'company_b', selectedPageId: '222', pages: [
      { id: '111', name: 'Other Page', accessToken: 'other-secret' },
      { id: '222', name: 'Own Page', accessToken: 'owner-secret' },
    ],
  }) });
  const doc = vi.fn(() => ({ get }));
  const db = { collection: vi.fn(() => ({ doc })) };
  vi.stubGlobal('fetch', vi.fn(async (url, options) => ({
    ok: true,
    json: async () => String(url).includes('/posts?')
      ? { data: [{ message: 'New product', created_time: '2026-10-21T03:00:00+0000', permalink_url: 'https://facebook.com/own/posts/1' }] }
      : { name: 'Own Page', link: 'https://facebook.com/own' },
  })));
  const result = await readConnectedFacebookPage(db, 'company_b');
  expect(doc).toHaveBeenCalledWith('company_b');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url, options]) => String(url).includes('/222') && options.headers.Authorization === 'Bearer owner-secret')).toBe(true);
  expect(result.posts[0].text).toBe('New product');
  expect(JSON.stringify(result)).not.toContain('owner-secret');
  vi.unstubAllGlobals();
});

it('requires a connected Page', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
  await expect(readConnectedFacebookPage(db, 'company_b')).rejects.toThrow(/Connect your Facebook Page/);
});

const profileDb = (profiles) => ({
  collection: (name) => ({ doc: (ownerId) => ({ get: async () => ({
    exists: Boolean(profiles[ownerId]),
    data: () => name === 'business_profiles' ? profiles[ownerId] : null,
  }) }) }),
});

it('reads only the signed-in owner saved public Facebook Page link', async () => {
  const db = profileDb({ company_a: { facebookPageUrl: 'https://www.facebook.com/company.a/' }, company_b: { facebookPageUrl: 'https://www.facebook.com/company.b/' } });
  const extract = vi.fn(async ({ url }) => ({ url, title: 'Company B', text: 'Public information about Company B. '.repeat(5) }));
  const readConnected = vi.fn(async () => { throw new Error('No connection'); });
  const result = await readProfileFacebookPage(db, 'company_b', { extract, readConnected });
  expect(extract).toHaveBeenCalledWith({ url: 'https://www.facebook.com/company.b/' });
  expect(result.pageUrl).toBe('https://www.facebook.com/company.b/');
  expect(result.postsReadable).toBe(false);
  expect(result.posts).toEqual([]);
});

it('does not return another connected Page when the saved profile URL differs', async () => {
  const db = profileDb({ company_b: { facebookPageUrl: 'https://www.facebook.com/company.b/' } });
  const readConnected = vi.fn(async () => ({ pageUrl: 'https://www.facebook.com/company.a/', posts: [{ text: 'Company A secret' }] }));
  const extract = vi.fn(async ({ url }) => ({ url, title: 'Company B', text: 'Public information about Company B. '.repeat(5) }));
  const result = await readProfileFacebookPage(db, 'company_b', { readConnected, extract });
  expect(result.text).toContain('Company B');
  expect(JSON.stringify(result)).not.toContain('Company A secret');
});

it('rejects a Facebook login wall instead of treating it as Page content', async () => {
  const db = profileDb({ company_b: { facebookPageUrl: 'https://www.facebook.com/company.b/' } });
  const extract = async ({ url }) => ({ url, title: 'Facebook – Log in or sign up', text: 'Log in to Facebook. '.repeat(10) });
  const readConnected = async () => { throw new Error('No connection'); };
  await expect(readProfileFacebookPage(db, 'company_b', { extract, readConnected })).rejects.toThrow(/did not expose readable Page content/);
});

it('uses Graph posts only when the connected Page matches the profile link', async () => {
  const db = profileDb({ company_b: { facebookPageUrl: 'https://www.facebook.com/company.b/' } });
  const extract = vi.fn();
  const result = await readProfileFacebookPage(db, 'company_b', {
    readConnected: async () => ({ pageUrl: 'https://facebook.com/company.b', posts: [{ text: 'New post' }], postsReadable: true }),
    extract,
  });
  expect(result.posts[0].text).toBe('New post');
  expect(extract).not.toHaveBeenCalled();
});

it('reads a saved numeric Facebook Page link through its matching connected Page ID', async () => {
  const savedUrl = 'https://www.facebook.com/profile.php?id=61590702807502';
  const db = profileDb({ company_b: { facebookPageUrl: savedUrl } });
  const extract = vi.fn();
  const result = await readProfileFacebookPage(db, 'company_b', {
    readConnected: async () => ({ pageId: '61590702807502', pageUrl: 'https://facebook.com/company.b', posts: [{ text: 'Today’s offer' }], postsReadable: true }),
    extract,
  });
  expect(result.profilePageUrl).toBe(savedUrl);
  expect(result.posts[0].text).toBe('Today’s offer');
  expect(extract).not.toHaveBeenCalled();
});

it('reads a saved numeric Facebook link that redirects to the Page public URL', async () => {
  const db = profileDb({ company_b: { facebookPageUrl: 'http://facebook.com/profile.php?id=61590702807502' } });
  const extract = vi.fn(async () => ({ url: 'https://www.facebook.com/company.b/', title: 'Company B', text: 'Company B sells coffee and pastries. '.repeat(5) }));
  const result = await readProfileFacebookPage(db, 'company_b', {
    readConnected: async () => { throw new Error('Not connected'); }, extract,
  });
  expect(extract).toHaveBeenCalledWith({ url: 'https://facebook.com/profile.php?id=61590702807502' });
  expect(result.pageUrl).toBe('http://facebook.com/profile.php?id=61590702807502');
  expect(result.text).toContain('coffee and pastries');
  expect(result.postsReadable).toBe(false);
});

it('rejects a numeric profile link redirected outside Facebook', async () => {
  const db = profileDb({ company_b: { facebookPageUrl: 'https://facebook.com/profile.php?id=61590702807502' } });
  await expect(readProfileFacebookPage(db, 'company_b', {
    readConnected: async () => { throw new Error('Not connected'); },
    extract: async () => ({ url: 'https://unrelated.example/', title: 'Company B', text: 'Company B text. '.repeat(10) }),
  })).rejects.toThrow(/did not expose readable Page content/);
});
