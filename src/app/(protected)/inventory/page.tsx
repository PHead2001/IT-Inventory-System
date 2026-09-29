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
      <h1 className="experience-heading mt-3">Inventory workspace</h1>
      <p className="experience-muted mt-3 max-w-2xl text-sm">
        Search available storage, assigned site holdings, and individually
        tracked assets.
      </p>
      {member.role === 'staff' && (
        <div className="my-5 flex flex-wrap gap-3">
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
      <div className="mt-6">
        <SearchForm
          params={params}
          categories={categories}
          locations={locations}
          sites={sites}
        />
        <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a
            className="min-h-11 py-3 text-cyan-300 underline"
            href={'/api/exports/inventory?' + exportParams}
          >
            Download filtered inventory CSV
          </a>
          <a
            className="min-h-11 py-3 text-cyan-300 underline"
            href={'/api/exports/inventory?export=low_stock&' + exportParams}
          >
            Download matching low-stock CSV
          </a>
          <a
            className="min-h-11 py-3 text-cyan-300 underline"
            href={'/api/exports/inventory?customFields=true&' + exportParams}
          >
            Download inventory CSV with custom fields
          </a>
        </div>
        {filters.lowStock && (
          <p className="mb-4 text-sm text-slate-400">
            Low-stock state uses available storage across all locations,
            including inactive ones. A site filter narrows rows, not the
            item-wide threshold calculation.
          </p>
        )}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">Matching inventory</h2>
          <p className="experience-muted text-sm tabular-nums">
            {result.total} results
          </p>
        </div>
        <InventoryRows rows={result.rows} fileSummaries={fileSummaries} />
        <Pagination result={result} base="/inventory" params={params} />
      </div>
    </>
  );
}
