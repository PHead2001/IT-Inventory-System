import { expect, it } from 'vitest';
import { safeRouteDocumentTitle } from './safe-route-document-title';
const id = '00000000-0000-4000-8000-000000000001';
it.each([
  ['/inventory', 'Inventory'],
  ['/inventory/assets/new', 'Add individual asset'],
  ['/inventory/quantity/new', 'Add quantity item'],
  ['/dashboard', 'Overview'],
  ['/labels', 'Labels'],
  ['/scan', 'Scan'],
  ['/room', 'Spaces & maps'],
  ['/locations', 'Locations'],
  ['/sites', 'Sites'],
  ['/history', 'History'],
  ['/settings', 'Settings'],
  ['/settings/categories', 'Categories'],
  ['/settings/forms', 'Category forms'],
  ['/settings/locations', 'Location settings'],
  ['/settings/sites', 'Site settings'],
  ['/settings/labels', 'Label settings'],
  [`/inventory/assets/${id}`, 'Individual asset'],
  [`/inventory/quantity/${id}`, 'Quantity item'],
  ['/locations/ITC-RED', 'Location details'],
  ['/sites/OWNED-SITE', 'Site details'],
  ['/sites/OWNED-SITE/open/quantity', 'Record existing quantity item'],
  ['/sites/OWNED-SITE/open/asset', 'Record existing individual asset'],
  [`/settings/forms/${id}`, 'Category forms'],
  ['/settings/locations/ITC-RED', 'Rename location'],
  ['/settings/sites/OWNED-SITE', 'Site details and settings'],
  [`/history/events/quantity/${id}`, 'History'],
  [`/history/events/asset/${id}`, 'History'],
])(
  'uses only the repository safe label for %s, regardless of query values',
  (route, title) => {
    expect(safeRouteDocumentTitle(route)).toBe(`${title} · IT Inventory`);
    expect(
      safeRouteDocumentTitle(
        route + '?name=Private+record&next=https%3A%2F%2Fevil.test',
      ),
    ).toBe(`${title} · IT Inventory`);
  },
);
it.each([
  '/unknown/Private-name',
  '//evil.test/inventory',
  'https://evil.test/inventory',
  '/inventory#private',
  '/inventory\\assets',
  '/inventory%2Fassets',
  '/inventory/assets/not-a-uuid',
  '/inventory/quantity/' + id + '/extra',
  '/locations/invalid-code',
  '/settings/forms/not-a-uuid',
  '/sites/' + 'X'.repeat(101),
  '/sites/OWNED-SITE/open/invalid',
  '/history/events/invalid/' + id,
  '/inventory?name=private\nrecord',
])('rejects unknown or malformed navigation %s without echoing it', (route) => {
  expect(safeRouteDocumentTitle(route)).toBe('IT Inventory');
});
