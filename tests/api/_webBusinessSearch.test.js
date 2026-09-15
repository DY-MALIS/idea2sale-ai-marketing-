import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webSearch: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));

import { searchBusinessesOnWeb } from '../../api/_webBusinessSearch.js';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('keeps official LinkedIn organization pages found by live search', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      businesses: [{
        name: 'Cambodia Academy',
        businessType: 'Training',
        linkedinUrl: 'https://www.linkedin.com/company/cambodia-academy/',
        sourceUrl: 'https://academy.example.com',
      }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const [business] = await searchBusinessesOnWeb({ searchTerms: 'training competitors' });

  expect(business.linkedinUrl).toBe('https://www.linkedin.com/company/cambodia-academy/');
});

it('drops personal LinkedIn profiles from business results', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      businesses: [{
        name: 'Cambodia Academy',
        linkedinUrl: 'https://www.linkedin.com/in/private-person/',
        sourceUrl: 'https://academy.example.com',
      }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const [business] = await searchBusinessesOnWeb({ searchTerms: 'training competitors' });

  expect(business.linkedinUrl).toBe('');
});

it('merges complementary search passes and keeps more than twelve verified businesses', async () => {
  const batches = Array.from({ length: 4 }, (_, batch) => ({
    businesses: Array.from({ length: 6 }, (_, index) => ({
      name: `Local Business ${batch * 6 + index + 1}`,
      businessType: 'Local shop',
      phone: `012 000 ${batch}${index}`,
      sourceUrl: `https://business-${batch}-${index}.example.com`,
    })),
  }));
  batches.forEach((batch) => mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify(batch) }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const businesses = await searchBusinessesOnWeb({ searchTerms: 'local shops' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(4);
  expect(businesses).toHaveLength(24);
});

it('deduplicates a business found by several passes and merges its public contacts', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({ businesses: [{ name: 'Same Cafe', phone: '012 345 678', sourceUrl: 'https://same-cafe.example.com' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ businesses: [{ name: 'Same Cafe', email: 'hello@same-cafe.example', sourceUrl: 'https://same-cafe.example.com' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ businesses: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ businesses: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const businesses = await searchBusinessesOnWeb({ searchTerms: 'cafes' });

  expect(businesses).toHaveLength(1);
  expect(businesses[0]).toMatchObject({ phone: '012 345 678', email: 'hello@same-cafe.example' });
});
