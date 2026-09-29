import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import {
  getInventory,
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import {
  InventoryRows,
  Pagination,
} from '@/features/inventory/components/read-ui';
import { SearchForm } from '@/features/inventory/components/search-form';
import { Button } from '@/components/ui/button';
import { readFilters } from '@/features/inventory/read-model';
import { getSites } from '@/features/custody/queries.server';
import { getFileListSummaries } from '@/features/files/list.server';
import { Download } from 'lucide-react';
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { member } = await requireMember();
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const [result, categories, locations, sites] = await Promise.all([
    getInventory(params),
    getCategories(),
    getLocations(),
    getSites(),
  ]);
  const fileSummaries = await getFileListSummaries(result.rows);
  const filters = readFilters(params);
  const exportParams = new URLSearchParams();
  if (filters.query) exportParams.set('q', filters.query);
  if (filters.type !== 'all') exportParams.set('type', filters.type);
  if (filters.status !== 'active') exportParams.set('status', filters.status);
  if (filters.category) exportParams.set('category', filters.category);
  if (filters.location) exportParams.set('location', filters.location);
  if (filters.site) exportParams.set('site', filters.site);
  if (filters.lowStock) exportParams.set('lowStock', 'true');
  return (
    <>
      <p className="experience-eyebrow">
        Logical storage and site custody · Inventory
      </p>
      <h1 className="experience-heading mt-2">Inventory</h1>
      <p className="experience-muted mt-2 max-w-2xl text-sm">
        Search available storage, assigned site holdings, and individually
        tracked assets.
      </p>
      {member.role === 'staff' && (
        <div className="my-3 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/inventory/quantity/new">
              Create quantity inventory
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/inventory/assets/new">Create serialized asset</Link>
          </Button>
        </div>
      )}
      <div className="mt-4">
        <SearchForm
          key={exportParams.toString()}
          params={params}
          categories={categories}
          locations={locations}
          sites={sites}
        />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Matching inventory</h2>
            <p className="experience-muted text-sm tabular-nums">
              {result.total} results
            </p>
          </div>
          <details className="experience-export-menu">
            <summary>
              <Download size={15} aria-hidden="true" /> Export CSV
            </summary>
            <div role="group" aria-label="CSV export options">
              <a href={'/api/exports/inventory?' + exportParams}>
                Filtered inventory
              </a>
              <a
                href={'/api/exports/inventory?export=low_stock&' + exportParams}
              >
                Matching low-stock items
              </a>
              <a
                href={
                  '/api/exports/inventory?customFields=true&' + exportParams
                }
              >
                Inventory with custom fields
              </a>
            </div>
          </details>
        </div>
        {filters.lowStock && (
          <p className="mb-4 text-sm text-slate-400">
            Low-stock state uses available storage across all locations,
            including inactive ones. A site filter narrows rows, not the
            item-wide threshold calculation.
          </p>
        )}
        <InventoryRows rows={result.rows} fileSummaries={fileSummaries} />
        <Pagination result={result} base="/inventory" params={params} />
      </div>
    </>
  );
}
