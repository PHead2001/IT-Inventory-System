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
  const [result, categories, locations] = await Promise.all([
    getInventory(params),
    getCategories(),
    getLocations(),
  ]);
  const filters = readFilters(params);
  const exportParams = new URLSearchParams();
  if (filters.query) exportParams.set('q', filters.query);
  if (filters.type !== 'all') exportParams.set('type', filters.type);
  if (filters.status !== 'active') exportParams.set('status', filters.status);
  if (filters.category) exportParams.set('category', filters.category);
  if (filters.location) exportParams.set('location', filters.location);
  if (filters.lowStock) exportParams.set('lowStock', 'true');
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        IT Closet · Inventory
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Inventory workspace</h1>
      <p className="mt-3 text-slate-400">
        Search stock and individually tracked assets across logical storage
        locations.
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
        />
        <div className="mb-5 flex flex-wrap gap-4 text-sm">
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
            Low-stock state uses each item’s total across all recorded
            locations, even when a location filter narrows the rows shown here.
          </p>
        )}
        <InventoryRows rows={result.rows} />
        <Pagination result={result} base="/inventory" params={params} />
      </div>
    </>
  );
}
