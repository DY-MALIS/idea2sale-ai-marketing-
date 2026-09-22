import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fetchMetaAdLibraryActivity, isMetaAdLibraryConfigured } from '../../api/_metaAdLibrary.js';

const ORIGINAL_TOKEN = process.env.META_AD_LIBRARY_ACCESS_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_TOKEN === undefined) delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  else process.env.META_AD_LIBRARY_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

it('reports unconfigured when no access token is set', () => {
  delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  expect(isMetaAdLibraryConfigured()).toBe(false);
});

it('reports configured once an access token is set', () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  expect(isMetaAdLibraryConfigured()).toBe(true);
});

it('returns an empty list without calling the network when unconfigured', async () => {
  delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchMetaAdLibraryActivity({ businessName: 'Rival Cafe' });

  expect(result).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('returns an empty list without calling the network when businessName is blank', async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchMetaAdLibraryActivity({ businessName: '' });

  expect(result).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('queries the ads_archive endpoint with the exact business name, country, and date window', async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
  vi.stubGlobal('fetch', fetchMock);

  await fetchMetaAdLibraryActivity({
    businessName: 'Rival Cafe',
    countryCode: 'kh',
    startDate: '2026-09-12',
    endDate: '2026-09-18',
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0];
  expect(url).toContain('https://graph.facebook.com/');
  expect(url).toContain('/ads_archive?');
  expect(url).toContain('access_token=test-token');
  expect(url).toContain('search_terms=Rival+Cafe');
  expect(url).toContain(encodeURIComponent('["KH"]'));
  expect(url).toContain('ad_delivery_date_min=2026-09-12');
  expect(url).toContain('ad_delivery_date_max=2026-09-18');
});

it('maps ads_archive results into the app activity shape', async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: [{
        page_name: 'Rival Cafe',
        ad_creative_bodies: ['Short body', 'A longer, more descriptive ad body about the weekend combo promo'],
        ad_creative_link_titles: ['Weekend Combo Promo'],
        ad_delivery_start_time: '2026-09-15T00:00:00-0700',
        ad_delivery_stop_time: '2026-09-20T00:00:00-0700',
        ad_snapshot_url: 'https://www.facebook.com/ads/library/?id=123456',
      }],
    }),
  })));

  const result = await fetchMetaAdLibraryActivity({ businessName: 'Rival Cafe', countryCode: 'KH' });

  expect(result).toEqual([{
    date: '2026-09-15',
    contentType: 'Ad',
    title: 'Weekend Combo Promo',
    activity: 'Weekend Combo Promo',
    summary: 'A longer, more descriptive ad body about the weekend combo promo',
    sourceUrl: 'https://www.facebook.com/ads/library/?id=123456',
  }]);
});

it('drops an ad with no delivery date or with no snapshot URL', async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: [
        { ad_creative_link_titles: ['No date ad'], ad_snapshot_url: 'https://www.facebook.com/ads/library/?id=1' },
        { ad_delivery_start_time: '2026-09-15T00:00:00-0700', ad_creative_link_titles: ['No snapshot URL'], ad_snapshot_url: '' },
      ],
    }),
  })));

  const result = await fetchMetaAdLibraryActivity({ businessName: 'Rival Cafe' });

  expect(result).toEqual([]);
});

it('returns an empty list instead of throwing on an API error response', async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    json: async () => ({ error: { message: 'Invalid OAuth access token.' } }),
  })));

  const result = await fetchMetaAdLibraryActivity({ businessName: 'Rival Cafe' });

  expect(result).toEqual([]);
});

it('returns an empty list instead of throwing on a network failure', async () => {
  process.env.META_AD_LIBRARY_ACCESS_TOKEN = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

  const result = await fetchMetaAdLibraryActivity({ businessName: 'Rival Cafe' });

  expect(result).toEqual([]);
});
