import { expect, it } from 'vitest';
import { resolveAutomationProductImageUrl } from '../../src/lib/productImageMatch';

const productImages = [
  { id: 'a', label: 'Lavender Face Cream', imageUrl: 'https://example.com/lavender.jpg', fileId: '', filePath: '' },
  { id: 'b', label: 'Iced Latte', imageUrl: 'https://example.com/latte.jpg', fileId: '', filePath: '' },
];

it('matches a saved product label named in the request text', () => {
  expect(resolveAutomationProductImageUrl('Make a video about our Lavender Face Cream', productImages))
    .toBe('https://example.com/lavender.jpg');
});

it('matches case-insensitively', () => {
  expect(resolveAutomationProductImageUrl('promote the iced latte for summer', productImages))
    .toBe('https://example.com/latte.jpg');
});

it('returns undefined when no saved label appears in the text', () => {
  expect(resolveAutomationProductImageUrl('Make a video about our new store opening', productImages))
    .toBeUndefined();
});

it('returns undefined with no saved product images', () => {
  expect(resolveAutomationProductImageUrl('Lavender Face Cream', [])).toBeUndefined();
});

it('ignores a saved image with an empty label', () => {
  const images = [{ id: 'c', label: '', imageUrl: 'https://example.com/unlabeled.jpg', fileId: '', filePath: '' }];
  expect(resolveAutomationProductImageUrl('anything', images)).toBeUndefined();
});
