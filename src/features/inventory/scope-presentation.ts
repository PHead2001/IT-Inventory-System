import { readFilters } from './read-model';
import type { InventoryResult, PageResult } from './contracts-ui';
import { countLabel } from '@/lib/count';

export function inventoryFilterParams(
  input: Record<string, string | undefined>,
) {
  const filters = readFilters(input);
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.status !== 'active') params.set('status', filters.status);
  for (const key of ['category', 'location', 'site'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.lowStock) params.set('lowStock', 'true');
  return params;
}
export function pageRecoveryHref(
  base: string,
  params: Record<string, string | undefined>,
  result: PageResult<unknown>,
) {
  const last = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (result.page <= last) return null;
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value && key !== 'page') query.set(key, value);
  });
  if (last > 1) query.set('page', String(last));
  return base + (query.size ? '?' + query : '');
}
export function pageInventoryCounts(rows: InventoryResult[]) {
  const quantities = rows.filter((row) => row.kind === 'quantity');
  const holdings = quantities.filter((row) => row.location || row.site).length;
  const unlocated = quantities.length - holdings;
  const assets = rows.filter((row) => row.kind === 'asset').length;
  return [
    holdings
      ? countLabel(
          holdings,
          'quantity row with stock',
          'quantity rows with stock',
        )
      : '',
    unlocated
      ? countLabel(
          unlocated,
          'quantity row without stock',
          'quantity rows without stock',
        )
      : '',
    assets ? countLabel(assets, 'individual asset row') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export function pageDistinctQuantityProducts(rows: InventoryResult[]) {
  return new Set(
    rows.filter((row) => row.kind === 'quantity').map((row) => row.id),
  ).size;
}
export function hasInventoryConstraints(
  input: Record<string, string | undefined>,
) {
  const f = readFilters(input);
  return Boolean(
    f.query ||
    f.type !== 'all' ||
    f.category ||
    f.location ||
    f.site ||
    f.lowStock,
  );
}
export function statusScope(status: string) {
  return status === 'all'
    ? 'All statuses'
    : status === 'historical'
      ? 'Archived / retired only'
      : 'Active only';
}
