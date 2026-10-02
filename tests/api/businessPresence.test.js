import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({ search: vi.fn(), page: vi.fn(), image: vi.fn(), publicUrl: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.search }));
vi.mock('../../api/_webBusinessSearch.js', () => ({
  fetchPublicPageIdentity: mocks.page,
  fetchPublicImage: mocks.image,
  isPublicHttpUrl: mocks.publicUrl,
}));

import { findBusinessPresence } from '../../api/_businessPresence.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.publicUrl.mockResolvedValue(true);
});

it('finds an alternate-name website by matching the profile introduction and actual logo, then follows its Page link', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#196acb' } }).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [
    { url: 'https://academy.example.com/', publicName: 'AI Learning Hub' },
    { url: 'https://other.example.com/', publicName: 'DJ Academy' },
  ] }) });
  mocks.page.mockImplementation(async (url) => url.includes('academy.example.com') ? {
    url,
    title: 'AI Learning Hub',
    description: 'AI skills training in Phnom Penh',
    text: 'AI skills training in Phnom Penh',
    imageCandidates: [{ url: 'https://academy.example.com/logo.png', placement: 'page logo' }],
    links: ['https://www.facebook.com/ai.learning.hub/'],
  } : {
    url, title: 'DJ Academy', description: 'Music events', text: 'Music events', imageUrls: [], links: [],
  });
  mocks.image.mockResolvedValue(logo);

  const presence = await findBusinessPresence({
    businessName: 'DJ Academy',
    businessDescription: 'AI skills training in Phnom Penh',
    logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`,
  });

  expect(presence.matches).toEqual(expect.arrayContaining([
    expect.objectContaining({ platform: 'Website', url: 'https://academy.example.com/', evidence: expect.arrayContaining(['Logo matches Business Profile (page logo)']) }),
    expect.objectContaining({ platform: 'Facebook', url: 'https://www.facebook.com/ai.learning.hub/' }),
  ]));
  expect(presence.matches.some((item) => item.url.includes('other.example.com'))).toBe(false);
  expect(presence.candidates.some((item) => item.url.includes('other.example.com'))).toBe(true);
});

it('captures a website and Page by the same logo even when their names and introductions differ', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#196acb' } }).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [
    { url: 'https://rhythm.example.com/', publicName: 'Rhythm Lab' },
    { url: 'https://www.facebook.com/rhythm.lab/', publicName: 'Rhythm Lab' },
  ] }) });
  mocks.page.mockImplementation(async (url) => url.includes('facebook.com') ? {
    url, title: 'Rhythm Lab', description: 'Music and events', text: 'Music and events',
    imageCandidates: [{ url: 'https://images.example.com/cover.png', placement: 'cover photo' }], links: [],
  } : {
    url, title: 'Rhythm Lab', description: 'Music and events', text: 'Music and events',
    imageCandidates: [{ url: 'https://rhythm.example.com/logo.png', placement: 'page logo' }], links: [],
  });
  mocks.image.mockResolvedValue(logo);

  const presence = await findBusinessPresence({
    businessName: 'DJ Academy', businessDescription: 'AI skills training in Phnom Penh',
    logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`,
  });

  expect(presence.matches).toEqual(expect.arrayContaining([
    expect.objectContaining({ platform: 'Website', url: 'https://rhythm.example.com/', evidence: ['Logo matches Business Profile (page logo)'] }),
    expect.objectContaining({ platform: 'Facebook', url: 'https://www.facebook.com/rhythm.lab/', evidence: ['Logo matches Business Profile (cover photo)'] }),
  ]));
});

it('does not treat logos with the same colors in a different arrangement as the same logo', async () => {
  const profileLogo = await sharp(Buffer.from('<svg width="40" height="40"><rect width="20" height="40" fill="blue"/><rect x="20" width="20" height="40" fill="red"/></svg>')).png().toBuffer();
  const otherLogo = await sharp(Buffer.from('<svg width="40" height="40"><rect width="20" height="40" fill="red"/><rect x="20" width="20" height="40" fill="blue"/></svg>')).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://rhythm.example.com/', publicName: 'Rhythm Lab' }] }) });
  mocks.page.mockResolvedValue({
    url: 'https://rhythm.example.com/', title: 'Rhythm Lab', description: 'Music and events', text: 'Music and events',
    imageCandidates: [{ url: 'https://rhythm.example.com/logo.png', placement: 'page logo' }], links: [],
  });
  mocks.image.mockResolvedValue(otherLogo);
  const presence = await findBusinessPresence({ businessName: 'DJ Academy', businessDescription: 'AI skills training in Phnom Penh', logoDataUrl: `data:image/png;base64,${profileLogo.toString('base64')}` });
  expect(presence.matches).toEqual([]);
});

it('does not call a search-only Page or owner-saved Page independently confirmed', async () => {
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [
    { url: 'https://www.facebook.com/kafe.dating/', publicName: 'Kafe' },
  ] }) });
  const presence = await findBusinessPresence({ businessName: 'Kafe Dating', facebookPageUrl: 'https://www.facebook.com/kafe.dating/' });
  expect(presence.matches).toEqual([]);
  expect(presence.candidates).toEqual([expect.objectContaining({ platform: 'Facebook', evidence: ['Saved in Business Profile'] })]);
});

it('matches a Khmer introduction on the first-party website', async () => {
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://kafe.example.com/', publicName: 'Kafe' }] }) });
  mocks.page.mockResolvedValue({
    url: 'https://kafe.example.com/', title: 'Kafe Dating',
    description: 'ហាងកាហ្វេ និងកន្លែងជួបជុំ', text: 'ហាងកាហ្វេ និងកន្លែងជួបជុំ',
    imageUrls: [], links: [],
  });
  const presence = await findBusinessPresence({ businessName: 'Kafe Dating', businessDescription: 'ហាងកាហ្វេ និងកន្លែងជួបជុំ' });
  expect(presence.matches).toEqual([expect.objectContaining({ platform: 'Website', url: 'https://kafe.example.com/' })]);
});

it('still shows an owner-saved Page for review if public search is unavailable', async () => {
  mocks.search.mockRejectedValue(new Error('Search unavailable'));
  const presence = await findBusinessPresence({ businessName: 'Kafe Dating', facebookPageUrl: 'https://www.facebook.com/kafe.dating/' });
  expect(presence.matches).toEqual([]);
  expect(presence.candidates).toEqual([expect.objectContaining({ url: 'https://www.facebook.com/kafe.dating/' })]);
});

it('confirms a Page-only business when its public Page itself matches the profile', async () => {
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://www.facebook.com/kafe.dating/', publicName: 'Kafe' }] }) });
  mocks.page.mockResolvedValue({
    url: 'https://www.facebook.com/kafe.dating/', title: 'Kafe Dating',
    description: 'Coffee and dating events in Phnom Penh', text: 'Coffee and dating events in Phnom Penh',
    imageUrls: [], links: [],
  });
  const presence = await findBusinessPresence({ businessName: 'Kafe Dating', businessDescription: 'Coffee and dating events in Phnom Penh' });
  expect(presence.matches).toEqual([expect.objectContaining({ platform: 'Facebook', evidence: expect.arrayContaining(['Introduction matches Page']) })]);
});

it('keeps the Page slug when a discovered Facebook URL uses the legacy pg prefix', async () => {
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [
    { url: 'https://www.facebook.com/pg/kafe.dating/', publicName: 'Kafe Dating' },
  ] }) });
  mocks.page.mockImplementation(async (url) => url === 'https://www.facebook.com/kafe.dating/' ? {
    url, title: 'Kafe Dating', description: 'Coffee and dating events in Phnom Penh',
    text: 'Coffee and dating events in Phnom Penh', imageUrls: [], links: [],
  } : null);

  const presence = await findBusinessPresence({
    businessName: 'Kafe Dating', businessDescription: 'Coffee and dating events in Phnom Penh',
  });

  expect(presence.matches).toEqual([expect.objectContaining({
    platform: 'Facebook', url: 'https://www.facebook.com/kafe.dating/',
  })]);
});

it('reports a matching Page profile photo and keeps a conflicting avatar out of confirmed matches', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#196acb' } }).png().toBuffer();
  const circularAvatar = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg width="40" height="40"><circle cx="20" cy="20" r="19" fill="#196acb"/></svg>') }]).png().toBuffer();
  const other = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#d23b28' } }).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://www.facebook.com/kafe.dating/', publicName: 'Kafe' }] }) });
  mocks.page.mockResolvedValue({
    url: 'https://www.facebook.com/kafe.dating/', title: 'Kafe Dating',
    description: 'Coffee and dating events in Phnom Penh', text: 'Coffee and dating events in Phnom Penh',
    imageCandidates: [{ url: 'https://images.example.com/avatar.png', placement: 'profile photo' }], links: [],
  });
  mocks.image.mockResolvedValueOnce(logo);
  const profile = { businessName: 'Kafe Dating', businessDescription: 'Coffee and dating events in Phnom Penh', logoDataUrl: `data:image/png;base64,${logo.toString('base64')}` };
  const matched = await findBusinessPresence(profile);
  expect(matched.matches).toEqual([expect.objectContaining({ evidence: expect.arrayContaining(['Logo matches Business Profile (profile photo)']) })]);

  mocks.image.mockResolvedValueOnce(circularAvatar);
  const cropped = await findBusinessPresence(profile);
  expect(cropped.matches).toEqual([expect.objectContaining({ evidence: expect.arrayContaining(['Logo matches Business Profile (profile photo)']) })]);

  mocks.image.mockResolvedValueOnce(other);
  const conflicting = await findBusinessPresence(profile);
  expect(conflicting.matches).toEqual([]);
  expect(conflicting.candidates).toEqual([expect.objectContaining({ evidence: expect.arrayContaining(['Page identity image could not be matched to profile logo']) })]);
});

it('does not confirm a website-linked Page when its profile photo conflicts with the Business Profile logo', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#196acb' } }).png().toBuffer();
  const other = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#d23b28' } }).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://kafe.example.com/', publicName: 'Kafe Dating' }] }) });
  mocks.page.mockImplementation(async (url) => url.includes('facebook.com') ? {
    url, title: 'Different Kafe', description: 'Coffee and dating events in Phnom Penh', text: 'Coffee and dating events in Phnom Penh',
    imageCandidates: [{ url: 'https://images.example.com/other.png', placement: 'profile photo' }], links: [],
  } : {
    url, title: 'Kafe Dating', description: 'Coffee and dating events in Phnom Penh', text: 'Coffee and dating events in Phnom Penh',
    imageCandidates: [{ url: 'https://kafe.example.com/logo.png', placement: 'page logo' }],
    links: ['https://www.facebook.com/kafe.dating/'],
  });
  mocks.image.mockImplementation(async (url) => url.includes('other.png') ? other : logo);
  const presence = await findBusinessPresence({
    businessName: 'Kafe Dating', businessDescription: 'Coffee and dating events in Phnom Penh',
    logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`,
  });
  expect(presence.matches).toEqual([expect.objectContaining({ platform: 'Website' })]);
  expect(presence.candidates).toEqual([expect.objectContaining({ platform: 'Facebook', evidence: expect.arrayContaining(['Page identity image could not be matched to profile logo']) })]);
});

it('keeps a Page under review when the profile has a logo but the Page image cannot be inspected', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#196acb' } }).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://www.facebook.com/kafe.dating/', publicName: 'Kafe Dating' }] }) });
  mocks.page.mockResolvedValue({
    url: 'https://www.facebook.com/kafe.dating/', title: 'Kafe Dating',
    description: 'Coffee and dating events in Phnom Penh', text: 'Coffee and dating events in Phnom Penh',
    imageCandidates: [], links: [],
  });
  const presence = await findBusinessPresence({
    businessName: 'Kafe Dating', businessDescription: 'Coffee and dating events in Phnom Penh',
    logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`,
  });
  expect(presence.matches).toEqual([]);
  expect(presence.candidates).toEqual([expect.objectContaining({ evidence: expect.arrayContaining(['Page logo not publicly available for comparison']) })]);
});

it('does not mistake a platform favicon or commenter avatar for the business Page logo', async () => {
  const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#196acb' } }).png().toBuffer();
  mocks.search.mockResolvedValue({ content: JSON.stringify({ candidates: [{ url: 'https://www.facebook.com/kafe.dating/', publicName: 'Kafe Dating' }] }) });
  mocks.page.mockResolvedValue({
    url: 'https://www.facebook.com/kafe.dating/', title: 'Kafe Dating',
    description: 'Coffee and dating events in Phnom Penh', text: 'Coffee and dating events in Phnom Penh',
    imageCandidates: [
      { url: 'https://www.facebook.com/favicon.png', placement: 'site icon' },
      { url: 'https://www.facebook.com/commenter.png', placement: 'profile photo', ownerImage: false },
    ], links: [],
  });
  mocks.image.mockResolvedValue(logo);
  const presence = await findBusinessPresence({
    businessName: 'Kafe Dating', businessDescription: 'Coffee and dating events in Phnom Penh',
    logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`,
  });
  expect(presence.matches).toEqual([]);
  expect(mocks.image).not.toHaveBeenCalled();
});
