import { describe, expect, it } from 'vitest';
import {
  inventoryReturnPath,
  inventoryRecordHref,
  inventoryRowAnchor,
} from './create-return';
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
    '/inventory?bad=%zz',
    '/sites/%2f%2fevil.test',
    '/sites/%5cevil',
  ])('rejects unknown or external origin %s', (origin) => {
    expect(inventoryReturnPath(origin)).toBe('/inventory');
  });
  it('carries validated filters/page and a safe row-position anchor as a shareable record return', () => {
    const row = {
      kind: 'quantity' as const,
      id: '00000000-0000-4000-8000-000000000001',
      location: { id: '00000000-0000-4000-8000-000000000002' },
    };
    const scope =
      '/inventory?q=USB&type=quantity&category=00000000-0000-4000-8000-000000000003&location=ITC-S1A&site=00000000-0000-4000-8000-000000000004&status=all&lowStock=true&page=2';
    const returned = `${scope}#${inventoryRowAnchor(1)}`;
    const href = new URL(
      inventoryRecordHref(row.kind, row.id, returned),
      'https://inventory.test',
    );
    expect(href.pathname).toBe(`/inventory/quantity/${row.id}`);
    expect(href.searchParams.get('returnTo')).toBe(returned);
    expect(inventoryReturnPath(href.searchParams.get('returnTo'))).toBe(
      returned,
    );
  });
  it('normalizes malformed filter values consistently with inventory and drops arbitrary fragments/recursive returns', () => {
    expect(
      inventoryReturnPath(
        '/inventory?type=broken&status=broken&category=bad&site=bad&page=-4&lowStock=no&q=%20USB%20#arbitrary',
      ),
    ).toBe('/inventory?type=all&status=active&page=1&q=USB');
    expect(
      inventoryReturnPath('/inventory?q=first&q=second&returnTo=%2Fsettings'),
    ).toBe('/inventory?q=first');
    expect(inventoryRecordHref('asset', 'id')).toBe('/inventory/assets/id');
  });
});
