import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webSearch: vi.fn(), lookup: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));

import { searchBusinessesOnWeb, urlIsReachable } from '../../api/_webBusinessSearch.js';

beforeEach(() => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

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

it('keeps the user query and scan objective separate in every search pass', async () => {
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ businesses: [] }) });

  await searchBusinessesOnWeb({
    searchTerms: 'Phnom Penh dental clinics',
    searchObjective: 'Find organizations likely to need video marketing.',
  });

  for (const [request] of mocks.webSearch.mock.calls) {
    expect(request.prompt).toContain('exact request: "Phnom Penh dental clinics"');
    expect(request.prompt).toContain('SCAN OBJECTIVE: Find organizations likely to need video marketing.');
  }
});

it('returns only employers with verified dated hiring evidence when hiring is required', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      businesses: [
        {
          name: 'Hiring Company',
          sourceUrl: 'https://hiring.example.com',
          recentActivities: [{ date: '2026-09-10', activity: 'Recruiting sales staff', jobTitle: 'Sales Executive', sourceUrl: 'https://hiring.example.com/jobs/sales' }],
        },
        { name: 'No Evidence Company', sourceUrl: 'https://no-evidence.example.com', recentActivities: [] },
      ],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const businesses = await searchBusinessesOnWeb({
    searchTerms: 'companies hiring staff',
    requiredSignal: 'hiring',
    activityStartDate: '2026-08-16',
    activityEndDate: '2026-09-15',
  });

  expect(businesses).toHaveLength(1);
  expect(businesses[0].businessName).toBe('Hiring Company');
  expect(businesses[0].recentActivities[0].activity).toContain('Recruiting');
  expect(businesses[0].recentActivities[0].jobTitle).toBe('Sales Executive');
});

it('supports public tradespeople and job seekers grouped by exact work type', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      businesses: [{
        name: 'Sokha Painting Service',
        entityKind: 'service_provider',
        serviceOrJobType: 'House painter',
        businessType: 'Painting service',
        phone: '012 345 678',
        sourceUrl: 'https://services.example.com/sokha-painting',
      }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const businesses = await searchBusinessesOnWeb({
    searchTerms: 'house painters Phnom Penh',
    entityScope: 'workers',
  });

  expect(mocks.webSearch.mock.calls[0][0].prompt).toContain('WORKER/TRADE SEARCH');
  expect(businesses[0]).toMatchObject({
    businessName: 'Sokha Painting Service',
    entityKind: 'service_provider',
    serviceOrJobType: 'House painter',
  });
});

it('rejects private, local, credentialed, and private-DNS URLs before fetching', async () => {
  vi.stubGlobal('fetch', vi.fn());

  for (const url of [
    'http://127.0.0.1/admin',
    'http://[::ffff:127.0.0.1]/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:3000',
    'https://user:password@example.com',
    'https://example.com:8443/private',
  ]) {
    expect(await urlIsReachable(url)).toBe(false);
  }

  mocks.lookup.mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);
  expect(await urlIsReachable('https://internal.example.com')).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('revalidates every redirect and blocks a public URL redirecting to a private host', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    status: 302,
    headers: { get: (name) => (name === 'location' ? 'http://127.0.0.1/admin' : null) },
  })));

  expect(await urlIsReachable('https://public.example.com/start')).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps a business whose Facebook Page is its only source even when the page blocks server-side fetches', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      businesses: [{
        name: 'Small Shop',
        businessType: 'Retail',
        sourceUrl: 'https://www.facebook.com/smallshop.kh',
      }],
    }),
  });
  // Facebook returning 403 to a server-side HEAD/GET is the real-world anti-bot
  // behavior this test guards against silently filtering out.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));

  const businesses = await searchBusinessesOnWeb({ searchTerms: 'small shops' });

  expect(businesses).toHaveLength(1);
  expect(businesses[0].businessName).toBe('Small Shop');
});

it('still drops an ordinary website that fails its HTTP check', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      businesses: [{ name: 'Dead Site Co', sourceUrl: 'https://dead-site.example.com' }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

  const businesses = await searchBusinessesOnWeb({ searchTerms: 'shops' });

  expect(businesses).toHaveLength(0);
});

it('caps and throttles business URL verification for oversized model responses', async () => {
  const businesses = Array.from({ length: 90 }, (_, index) => ({
    name: `Business ${index + 1}`,
    sourceUrl: `https://business-${index + 1}.example.com`,
  }));
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ businesses }) });
  let activeRequests = 0;
  let peakRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    activeRequests += 1;
    peakRequests = Math.max(peakRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeRequests -= 1;
    return { ok: true, status: 200 };
  }));

  const result = await searchBusinessesOnWeb({ searchTerms: 'large category' });

  expect(result).toHaveLength(75);
  expect(fetch).toHaveBeenCalledTimes(75);
  expect(peakRequests).toBeLessThanOrEqual(8);
});
