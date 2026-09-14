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
