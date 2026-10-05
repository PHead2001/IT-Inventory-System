import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  inventoryFilterParams,
  pageRecoveryHref,
  hasInventoryConstraints,
} from '@/features/inventory/scope-presentation';
import { requireMember } from '@/lib/auth/session.server';
import {
  getInventory,
  getCategories,
  getLocations,
  hasRecordedInventory,
} from '@/features/inventory/queries.server';
import {
  InventoryRows,
  InventoryCount,
  panel,
  Pagination,
} from '@/features/inventory/components/read-ui';
import { SearchForm } from '@/features/inventory/components/search-form';
import { Button } from '@/components/ui/button';
import { readFilters } from '@/features/inventory/read-model';
import { getSites } from '@/features/custody/queries.server';
import { getFileListSummaries } from '@/features/files/list.server';
import { Download } from 'lucide-react';
import {
  authDiagnosticsEnabled,
  createAuthDiagnostic,
  observeAuthStage,
} from '@/lib/auth/diagnostic.server';
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const diagnostic = createAuthDiagnostic();
  const { member } = await observeAuthStage(
    diagnostic,
    'inventory.pageMembership',
    () => requireMember(),
  );
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const [result, categories, locations, sites] = await observeAuthStage(
    diagnostic,
    'inventory.parallelReads',
    () =>
      Promise.all([
        observeAuthStage(diagnostic, 'inventory.search', () =>
          getInventory(params),
        ),
        observeAuthStage(diagnostic, 'inventory.categories', () =>
          getCategories(),
        ),
        observeAuthStage(diagnostic, 'inventory.locations', () =>
          getLocations(),
        ),
        observeAuthStage(diagnostic, 'inventory.sites', () => getSites()),
      ]),
  );
  const fileSummaries = await observeAuthStage(
    diagnostic,
    'inventory.fileSummaries',
    () => getFileListSummaries(result.rows),
  );
  const filters = readFilters(params);
  const exportParams = inventoryFilterParams(params);
  const recovery = pageRecoveryHref(
    '/inventory',
    Object.fromEntries(exportParams),
    result,
  );
  if (recovery) redirect(recovery);
  const constrained = hasInventoryConstraints(params);
  const recorded =
    result.total === 0 && !constrained ? await hasRecordedInventory() : null;
  const emptyMessage = constrained
    ? 'No inventory matches these filters.'
    : !recorded
      ? 'No inventory has been recorded yet.'
      : filters.status === 'active'
        ? 'No active inventory. Historical records are available.'
        : 'No inventory in this status scope.';
  const returnParams = new URLSearchParams(exportParams);
  if (params.page) returnParams.set('page', params.page);
  const returnTo =
    '/inventory' + (returnParams.size ? '?' + returnParams.toString() : '');
  const createQuery = new URLSearchParams({ returnTo }).toString();
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
          <div className="min-w-0 flex-1 basis-64">
            <Button asChild>
              <Link
                href={'/inventory/quantity/new?' + createQuery}
                aria-describedby="quantity-choice-description"
              >
                Add quantity item
              </Link>
            </Button>
            <p
              id="quantity-choice-description"
              className="mt-2 text-sm text-slate-300"
            >
              Track interchangeable items by count, such as cables and adapters.
            </p>
          </div>
          <div className="min-w-0 flex-1 basis-64">
            <Button asChild variant="outline">
              <Link
                href={'/inventory/assets/new?' + createQuery}
                aria-describedby="asset-choice-description"
              >
                Add individual asset
              </Link>
            </Button>
            <p
              id="asset-choice-description"
              className="mt-2 text-sm text-slate-300"
            >
              Track one specific device, such as a laptop or switch.
            </p>
          </div>
        </div>
      )}
      <div className="mt-4">
        <SearchForm
          key={exportParams.toString()}
          params={params}
          categories={categories}
          locations={locations}
          sites={sites}
          diagnosticsEnabled={authDiagnosticsEnabled()}
        />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Matching inventory</h2>
            <InventoryCount result={result} />
          </div>
          <details className="experience-export-menu">
            <summary>
              <Download size={15} aria-hidden="true" /> Export CSV
            </summary>
            <div role="group" aria-label="CSV export options">
              <ExportLink href={'/api/exports/inventory?' + exportParams}>
                Filtered inventory
              </ExportLink>
              <ExportLink
                href={'/api/exports/inventory?export=low_stock&' + exportParams}
              >
                Matching low-stock items
              </ExportLink>
              <ExportLink
                href={
                  '/api/exports/inventory?customFields=true&' + exportParams
                }
              >
                Inventory with custom fields
              </ExportLink>
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
        <InventoryRows
          rows={result.rows}
          fileSummaries={fileSummaries}
          emptyState={
            <div className={panel}>
              <p>{emptyMessage}</p>
              {constrained ? (
                <Link
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                  href="/inventory"
                >
                  Clear inventory filters
                </Link>
              ) : recorded ? (
                <Link
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                  href="/inventory?status=all"
                >
                  Include all statuses
                </Link>
              ) : member.role === 'staff' ? (
                <Link
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                  href={'/inventory/quantity/new?' + createQuery}
                >
                  Add the first quantity item
                </Link>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  Ask an IT staff member to add the first record.
                </p>
              )}
            </div>
          }
        />
        <Pagination result={result} base="/inventory" params={params} />
      </div>
    </>
  );
}
import { ExportLink } from '@/components/operational-time';
