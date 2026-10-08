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
    '2 quantity rows with stock · 1 quantity row without stock · 1 individual asset row',
  );
});

it('includes assigned rows in the partition and counts asset rows without overlapping product definitions', () => {
  const row = {
    kind: 'quantity',
    id: 'cable',
    quantity: 3,
    location: { id: 'shelf' },
  } as InventoryResult;
  expect(
    pageInventoryCounts([
      row,
      {
        ...row,
        location: null,
        site: { id: 'site', code: 'HQ', name: 'Headquarters' },
      },
      { ...row, id: 'empty', location: null, quantity: 0 },
      { ...row, id: 'asset', kind: 'asset', quantity: null },
      { ...row, id: 'asset', kind: 'asset', quantity: null },
    ]),
  ).toBe(
    '2 quantity rows with stock · 1 quantity row without stock · 2 individual asset rows',
  );
});
