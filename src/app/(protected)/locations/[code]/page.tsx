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
      <Link
        className="inline-flex min-h-11 items-center text-cyan-300 underline"
        href="/locations"
      >
        All locations
      </Link>
      <p className="experience-eyebrow mt-3">Storage / Location</p>
      <h1 className="experience-heading mt-1 break-words">{location.name}</h1>
      <Link
        className="inline-block min-h-11 py-3 text-sm text-cyan-300 underline"
        href={'/labels?location=' + encodeURIComponent(location.code)}
      >
        Print location label
      </Link>
      <p className="my-3 break-words text-sm leading-6 text-slate-300">
        {location.breadcrumb} · {location.code} ·{' '}
        {!location.active
          ? 'Inactive'
          : location.can_hold_inventory
            ? 'Inventory destination'
            : 'Includes child locations'}
      </p>
      <ShowInRoom location={location} />
      {children.length > 0 && (
        <section className={panel + ' mb-5'}>
          <h2 className="mb-3 text-lg font-semibold">Child locations</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {children.map((child) => (
              <li key={child.id}>
                <LocationLink location={child} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav
        aria-label="Location inventory views"
        className="my-5 flex flex-wrap gap-x-5 gap-y-1 text-sm"
      >
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
      </nav>
      <InventoryRows rows={result.rows} />
      <Pagination
        result={result}
        base={'/locations/' + encodeURIComponent(code)}
        params={filters}
      />
    </>
  );
}
