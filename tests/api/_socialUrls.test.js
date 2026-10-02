import { expect, it } from 'vitest';
import { facebookBusinessPageKey } from '../../api/_socialUrls.js';

it('identifies distinct Facebook Pages behind the legacy pg URL prefix', () => {
  expect(facebookBusinessPageKey('https://www.facebook.com/pg/djacademy/')).toBe('djacademy');
  expect(facebookBusinessPageKey('https://m.facebook.com/pg/anotheracademy/posts/123')).toBe('anotheracademy');
  expect(facebookBusinessPageKey('https://www.facebook.com/pg/')).toBe('');
});
