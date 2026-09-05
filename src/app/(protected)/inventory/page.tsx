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
        <InventoryRows rows={result.rows} />
        <Pagination result={result} base="/inventory" params={params} />
      </div>
    </>
  );
}
