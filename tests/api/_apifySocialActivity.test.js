import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { fetchApifySocialActivity, isApifySocialActivityConfigured } from '../../api/_apifySocialActivity.js';

const originalToken = process.env.APIFY_API_TOKEN;

beforeEach(() => {
  delete process.env.APIFY_API_TOKEN;
  delete process.env.APIFY_FACEBOOK_POSTS_ACTOR;
  delete process.env.APIFY_TIKTOK_ACTOR;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.APIFY_API_TOKEN;
  else process.env.APIFY_API_TOKEN = originalToken;
});

it('does not make paid actor requests when no Apify token is configured', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  expect(isApifySocialActivityConfigured()).toBe(false);
  await expect(fetchApifySocialActivity({
    candidates: [{ name: 'Rival', facebookUrl: 'https://www.facebook.com/rival' }],
    startDate: '2026-09-16',
    endDate: '2026-09-22',
  })).resolves.toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('batches exact public profiles and normalizes direct Facebook and TikTok evidence', async () => {
  process.env.APIFY_API_TOKEN = 'private-token';
  const fetchMock = vi.fn(async (url, options) => {
    expect(String(url)).not.toContain('private-token');
    expect(options.headers.Authorization).toBe('Bearer private-token');
    const input = JSON.parse(options.body);
    if (String(url).includes('facebook-posts-scraper')) {
      expect(input).toMatchObject({
        startUrls: [{ url: 'https://www.facebook.com/rivalacademy' }],
        resultsLimit: 14,
        onlyPostsNewerThan: '2026-09-16',
        onlyPostsOlderThan: '2026-09-22',
      });
      return {
        ok: true,
        json: async () => [{
          facebookUrl: 'https://facebook.com/rivalacademy/',
          url: 'https://www.facebook.com/rivalacademy/posts/123',
          time: '2026-09-20T08:00:00.000Z',
          text: 'Registration is open for the new AI course.',
          likes: 25,
          comments: 4,
          shares: 2,
        }],
      };
    }
    expect(input).toMatchObject({
      profiles: ['rivalacademy'],
      profileScrapeSections: ['videos'],
      profileSorting: 'latest',
      resultsPerPage: 14,
      oldestPostDateUnified: '2026-09-16',
      newestPostDate: '2026-09-22',
      shouldDownloadVideos: false,
    });
    return {
      ok: true,
      json: async () => [{
        authorMeta: { name: 'rivalacademy', profileUrl: 'https://www.tiktok.com/@rivalacademy' },
        webVideoUrl: 'https://www.tiktok.com/@rivalacademy/video/456',
        createTimeISO: '2026-09-21T09:00:00.000Z',
        text: 'Three practical marketing tips for small businesses.',
        diggCount: 120,
        commentCount: 8,
        shareCount: 11,
        playCount: 2500,
      }],
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  const activities = await fetchApifySocialActivity({
    candidates: [{
      name: 'Rival Academy',
      facebookUrl: 'https://www.facebook.com/rivalacademy',
      tiktokUrl: 'https://www.tiktok.com/@rivalacademy',
    }],
    startDate: '2026-09-16',
    endDate: '2026-09-22',
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(activities).toEqual([
    expect.objectContaining({
      competitorName: 'Rival Academy',
      date: '2026-09-20',
      contentType: 'Post',
      activity: expect.stringContaining('Registration is open'),
      keyDetails: ['Reactions: 25', 'Comments: 4', 'Shares: 2'],
      sourceUrl: 'https://www.facebook.com/rivalacademy/posts/123',
    }),
    expect.objectContaining({
      competitorName: 'Rival Academy',
      date: '2026-09-21',
      contentType: 'Video',
      activity: expect.stringContaining('Three practical marketing tips'),
      keyDetails: ['Likes: 120', 'Comments: 8', 'Shares: 11', 'Plays: 2,500'],
      sourceUrl: 'https://www.tiktok.com/@rivalacademy/video/456',
    }),
  ]);
});

it('fails open when either actor is unavailable or returns invalid data', async () => {
  process.env.APIFY_API_TOKEN = 'private-token';
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('facebook-posts-scraper')) throw new Error('actor unavailable');
    return { ok: false, json: async () => ({ error: 'quota exceeded' }) };
  }));

  await expect(fetchApifySocialActivity({
    candidates: [{
      name: 'Rival Academy',
      facebookUrl: 'https://www.facebook.com/rivalacademy',
      tiktokUrl: 'https://www.tiktok.com/@rivalacademy',
    }],
    startDate: '2026-09-16',
    endDate: '2026-09-22',
  })).resolves.toEqual([]);
});
