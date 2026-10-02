import { describe, expect, it } from 'vitest';
import { inventoryReturnPath } from './create-return';
describe('create Cancel origins', () => {
  it('preserves useful inventory filters and known site paths', () => {
    expect(
      inventoryReturnPath(
        '/inventory?q=USB&type=quantity&location=ITC-S1A&page=2&returnTo=https://evil.test',
      ),
    ).toBe('/inventory?q=USB&type=quantity&location=ITC-S1A&page=2');
    expect(inventoryReturnPath('/sites/PROPERTY-A')).toBe('/sites/PROPERTY-A');
  });
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/inventory/quantity/new',
    '/settings',
    '/sites/PROPERTY-A/open/asset',
    '/inventory\n',
    '/inventory/../settings',
  ])('rejects unknown or external origin %s', (origin) => {
    expect(inventoryReturnPath(origin)).toBe('/inventory');
  });
});
