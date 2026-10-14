import { RouteReady } from '@/components/experience/route-ready';
import {
  RecordTitle,
  InventoryBackLink,
} from '@/components/experience/record-transition';
import { locationDetailReturnPath } from '@/features/inventory/detail-return';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { PrivateDocumentTitle } from '@/components/auth/private-document-title';
import { readLocationPage } from './read.server';
import { recordTitle } from '@/app/(protected)/record-title';
export function generateMetadata() {
  return recordTitle('Location details');
}
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { ShowInRoom } from '@/features/room/show-in-room';
import Link from '@/components/experience/route-link';
import { notFound, redirect } from 'next/navigation';
import { readFilters } from '@/features/inventory/read-model';
import {
  inventoryFilterParams,
  pageRecoveryHref,
  statusScope,
  hasInventoryConstraints,
} from '@/features/inventory/scope-presentation';
import {
  getInventory,
  getLocations,
} from '@/features/inventory/queries.server';
import {
  InventoryRows,
  Pagination,
  InventoryCount,
  LocationCode,
  panel,
} from '@/features/inventory/components/read-ui';
export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const raw = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const returnTo = locationDetailReturnPath(filters.returnTo);
  const location = await readLocationPage(code);
  if (!location) notFound();
  const [result, locations] = await Promise.all([
    getInventory({ ...filters, location: code }),
    getLocations(),
  ]);
  const children = locations.filter((l) => l.parentId === location.id);
  const filter = readFilters({ ...filters, location: code });
  const scopeParams = inventoryFilterParams({ ...filters, location: code });
  const normalizedParams = {
    ...Object.fromEntries(scopeParams),
    ...(filters.returnTo ? { returnTo } : {}),
    page: String(filter.page),
  };
  const base = '/locations/' + encodeURIComponent(code);
  const recovery = pageRecoveryHref(base, normalizedParams, result);
  if (recovery) redirect(recovery);
  const scopeHref = (status: string) => {
    const query = inventoryFilterParams({ ...filters, status });
    query.delete('location');
    if (filters.returnTo) query.set('returnTo', returnTo);
    return base + (query.size ? '?' + query : '');
  };
  const childHref = (childCode: string) =>
    '/locations/' +
    encodeURIComponent(childCode) +
    (filters.returnTo ? '?' + new URLSearchParams({ returnTo }) : '');
  const constrained = hasInventoryConstraints({
    ...filters,
    location: undefined,
  });
  const readiness = await routeReadyProps(base, searchParams);
  return (
    <ProtectedPrivacyContent routeKey={readiness.routeKey}>
      <RouteReady {...readiness} conventionalPrimary>
        <PrivateDocumentTitle
          routePath={`/locations/${encodeURIComponent(code)}`}
          title={recordTitle(location.name, 'Locations').title.absolute}
        />
        <>
          <InventoryBackLink
            record={{ kind: 'location', id: location.id, code: location.code }}
            className="inline-flex min-h-11 items-center text-cyan-300 underline"
            href={returnTo}
          >
            All locations
          </InventoryBackLink>
          <p className="experience-eyebrow mt-3">Storage / Location</p>
          <RecordTitle
            record={{ kind: 'location', id: location.id, code: location.code }}
            className="experience-heading mt-1 break-words"
          >
            {location.name}
          </RecordTitle>
          <p className="my-3 break-words text-sm leading-6 text-slate-300">
            {location.breadcrumb} ·{' '}
            {!location.active
              ? 'Inactive'
              : location.can_hold_inventory
                ? 'Inventory destination'
                : 'Includes child locations'}
          </p>
          <LocationCode code={location.code} />
          <nav
            aria-label="Location actions"
            className="my-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
          >
            <ShowInRoom location={location} />
            <Link
              className="min-h-11 py-3 text-cyan-300 underline"
              href={'/labels?location=' + encodeURIComponent(location.code)}
            >
              Print label
            </Link>
            <Link
              className="min-h-11 py-3 text-cyan-300 underline"
              href={'/history?location=' + encodeURIComponent(code)}
            >
              History
            </Link>
            <ExportLink
              className="min-h-11 py-3 text-cyan-300 underline"
              href={'/api/exports/inventory?' + scopeParams}
            >
              Export
            </ExportLink>
          </nav>
          {children.length > 0 && (
            <section className={panel + ' mb-5'}>
              <h2 className="mb-3 text-lg font-semibold">Child locations</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {children.map((child) => (
                  <li
                    key={child.id}
                    className="min-w-0 rounded-md border border-slate-700 p-3"
                  >
                    <Link
                      className="break-words text-cyan-300 underline"
                      aria-label={`${child.breadcrumb} (${child.code})`}
                      href={childHref(child.code)}
                    >
                      {child.name}
                    </Link>
                    <LocationCode code={child.code} />
                    <p className="mt-1 text-xs text-slate-400">
                      {!child.active
                        ? 'Inactive'
                        : child.can_hold_inventory
                          ? 'Inventory destination'
                          : 'Location group'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <nav
            aria-label="Location inventory views"
            className="my-5 flex flex-wrap gap-x-5 gap-y-1 text-sm"
          >
            {[
              'active',
              'all',
              ...(filter.status === 'historical' ? ['historical'] : []),
            ].map((status) => (
              <Link
                key={status}
                aria-current={filter.status === status ? 'page' : undefined}
                className="min-h-11 rounded-md border border-slate-600 px-3 py-3 text-cyan-300 aria-[current=page]:border-cyan-300 aria-[current=page]:bg-cyan-950 aria-[current=page]:font-semibold"
                href={scopeHref(status)}
              >
                {statusScope(status)}
              </Link>
            ))}
          </nav>
          <div className="mb-3">
            <h2 className="font-semibold">
              {location.can_hold_inventory
                ? 'Inventory at this location'
                : 'Inventory in this area and its descendants'}
            </h2>
            <InventoryCount result={result} compact />
          </div>
          <InventoryRows
            rows={result.rows}
            currentLocationId={location.id}
            emptyState={
              <div className={panel}>
                <p>
                  {constrained
                    ? 'No inventory here matches the selected filters.'
                    : filter.status === 'active'
                      ? 'No active inventory here.'
                      : filter.status === 'historical'
                        ? 'No archived or retired inventory here.'
                        : 'No recorded inventory here.'}
                </p>
                <Link
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                  href={
                    filter.status === 'active' ? scopeHref('all') : '/inventory'
                  }
                >
                  {filter.status === 'active'
                    ? 'Include all statuses'
                    : 'Search all inventory'}
                </Link>
              </div>
            }
          />
          <Pagination
            result={result}
            base={'/locations/' + encodeURIComponent(code)}
            params={normalizedParams}
          />
        </>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
import { ExportLink } from '@/components/operational-time';
