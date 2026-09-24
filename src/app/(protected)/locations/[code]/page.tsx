import { ShowInRoom } from '@/features/room/show-in-room';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLocation,
  getInventory,
  getLocations,
} from '@/features/inventory/queries.server';
import {
  InventoryRows,
  Pagination,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { code } = await params;
  const filters = await searchParams;
  const location = await getLocation(code);
  if (!location) notFound();
  const [result, locations] = await Promise.all([
    getInventory({ ...filters, location: code }),
    getLocations(),
  ]);
  const children = locations.filter((l) => l.parentId === location.id);
  return (
    <>
      <Link className="text-cyan-300 underline" href="/locations">
        All locations
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{location.name}</h1>
      <Link
        className="inline-block min-h-11 py-3 text-sm text-cyan-300 underline"
        href={'/labels?location=' + encodeURIComponent(location.code)}
      >
        Print location label
      </Link>
      <p className="my-3 break-words text-slate-400">
        {location.breadcrumb} · {location.code} ·{' '}
        {!location.active
          ? 'Inactive'
          : location.can_hold_inventory
            ? 'Inventory destination'
            : 'Includes child locations'}
      </p>
      <ShowInRoom code={code} />
      {children.length > 0 && (
        <section className={panel + ' mb-5'}>
          <h2 className="mb-3 font-semibold">Child locations</h2>
          <ul className="space-y-3">
            {children.map((child) => (
              <li key={child.id}>
                <LocationLink location={child} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="my-5 flex flex-wrap gap-5 text-sm">
        <Link
          className="min-h-11 py-3 text-cyan-300 underline"
          href={'/locations/' + encodeURIComponent(code)}
        >
          Active inventory
        </Link>
        <Link
          className="min-h-11 py-3 text-cyan-300 underline"
          href={'/locations/' + encodeURIComponent(code) + '?status=all'}
        >
          Include archived / retired
        </Link>
        <Link
          className="min-h-11 py-3 text-cyan-300 underline"
          href={'/history?location=' + encodeURIComponent(code)}
        >
          Location history
        </Link>
        <a
          className="min-h-11 py-3 text-cyan-300 underline"
          href={
            '/api/exports/inventory?location=' +
            encodeURIComponent(code) +
            (filters.status === 'all' || filters.status === 'historical'
              ? '&status=' + filters.status
              : '')
          }
        >
          Download location inventory CSV
        </a>
      </div>
      <InventoryRows rows={result.rows} />
      <Pagination
        result={result}
        base={'/locations/' + encodeURIComponent(code)}
        params={filters}
      />
    </>
  );
}
