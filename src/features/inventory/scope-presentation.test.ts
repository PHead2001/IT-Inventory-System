import { expect, it } from 'vitest';
import {
  inventoryFilterParams,
  pageRecoveryHref,
  pageInventoryCounts,
  statusScope,
} from './scope-presentation';
import type { InventoryResult } from './contracts-ui';
it('uses the normalized inventory filter contract for URLs and export with historical links intact', () => {
  expect(
    inventoryFilterParams({
      q: '  Cable  ',
      type: 'invalid',
      status: 'historical',
      location: 'ITC',
      page: '99',
      category: 'invalid',
      lowStock: 'true',
    }).toString(),
  ).toBe('q=Cable&status=historical&location=ITC&lowStock=true');
  expect(statusScope('historical')).toBe('Archived / retired only');
});
it('clamps invalid pages once to the last available page without dropping filters', () => {
  const result = { rows: [], total: 26, page: 99, pageSize: 25 };
  expect(
    pageRecoveryHref(
      '/inventory',
      { q: 'Cable', status: 'all', page: '99' },
      result,
    ),
  ).toBe('/inventory?q=Cable&status=all&page=2');
  expect(
    pageRecoveryHref('/inventory', { q: 'Cable' }, { ...result, page: 2 }),
  ).toBeNull();
  expect(
    pageRecoveryHref(
      '/inventory',
      { q: 'Cable', page: '99' },
      { ...result, total: 0 },
    ),
  ).toBe('/inventory?q=Cable');
});
it('does not mix assets, unlocated definitions, holdings, or their different stock totals', () => {
  const row = {
    id: 'same',
    kind: 'quantity',
    location: { id: 'location' },
    quantity: 5,
  } as InventoryResult;
  expect(
    pageInventoryCounts([
      row,
      row,
      { ...row, location: null },
      { ...row, kind: 'asset', location: null },
    ]),
  ).toBe(
    '2 quantity holdings · 1 quantity item · 1 unlocated definition · 1 serialized asset',
  );
});
