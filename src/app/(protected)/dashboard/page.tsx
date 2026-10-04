import Link from 'next/link';
import { countLabel } from '@/lib/count';
import {
  ArrowRight,
  CircleCheck,
  Download,
  Map,
  SlidersHorizontal,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getLowStockDashboard } from '@/features/inventory/queries.server';
import { Pagination } from '@/features/inventory/components/read-ui';
import { RefreshButton } from '@/features/inventory/components/refresh-button';
import { ClosetPreview } from '@/components/experience/closet-preview';
import { AmbientLight } from '@/components/experience/ambient-light';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  const result = await getLowStockDashboard(page);
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (result.page > lastPage) redirect('/dashboard?page=1');
  return (
    <div className="space-y-5">
      <section className="experience-overview-hero experience-surface-bright">
        <AmbientLight />
        <div>
          <p className="experience-eyebrow">Storage availability · Overview</p>
          <h1 className="experience-heading mt-3">Low-stock overview</h1>
          <p className="experience-muted mt-3 max-w-xl text-sm leading-6">
            Keep storage ready for the next request. See which items need
            attention.
          </p>
          <Link
            href="/room"
            className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white"
          >
            <Map size={16} aria-hidden="true" /> Explore Spaces &amp; maps{' '}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <div className="experience-closet-preview">
          <ClosetPreview />
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="experience-eyebrow">Live inventory</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            Storage health
          </h2>
        </div>
        <RefreshButton />
      </div>
      <dl className="experience-stat-grid">
        <div className="experience-stat experience-surface">
          <dt className="experience-muted text-xs">Needs restocking</dt>
          <dd
            className={
              result.configuredCount ? 'text-amber-200' : 'text-slate-300'
            }
          >
            {result.configuredCount ? (
              result.needsRestockingCount
            ) : (
              <span className="text-base">Not configured</span>
            )}
          </dd>
        </div>
        <div className="experience-stat experience-surface">
          <dt className="experience-muted text-xs">Out of stock (subset)</dt>
          <dd
            className={
              result.configuredCount ? 'text-red-200' : 'text-slate-300'
            }
          >
            {result.configuredCount ? (
              result.outOfStockCount
            ) : (
              <span className="text-base">Not configured</span>
            )}
          </dd>
        </div>
        <div className="experience-stat experience-surface">
          <dt className="experience-muted text-xs">Monitored active items</dt>
          <dd>{result.configuredCount}</dd>
        </div>
      </dl>
      <p className="experience-muted text-sm">
        {countLabel(result.configuredCount, 'monitored active quantity item')}.{' '}
        {result.configuredCount
          ? 'Alert counts apply only to this monitored set.'
          : 'Stock monitoring needs a reorder threshold.'}{' '}
        <Link
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
          href="/inventory?type=quantity"
        >
          Browse quantity items and thresholds
        </Link>
      </p>
      <section aria-labelledby="attention-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="experience-eyebrow">Action queue</p>
            <h2
              id="attention-heading"
              className="mt-1 text-lg font-semibold tracking-tight"
            >
              Items needing attention
            </h2>
          </div>
          <div className="flex flex-wrap gap-4 text-xs font-semibold text-cyan-200">
            <Link
              href="/inventory?lowStock=true"
              className="inline-flex min-h-11 items-center gap-1 hover:text-white"
            >
              View filtered inventory{' '}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <a
              href="/api/exports/inventory?export=low_stock"
              className="inline-flex min-h-11 items-center gap-1 hover:text-white"
            >
              <Download size={14} aria-hidden="true" /> Download low-stock CSV
            </a>
          </div>
        </div>
        {result.configuredCount === 0 ? (
          <div className="experience-surface experience-empty-state">
            <SlidersHorizontal size={26} aria-hidden="true" />
            <div>
              <h3 className="font-semibold">No items are monitored yet</h3>
              <p className="experience-muted mt-1 text-sm">
                No active quantity item has a reorder threshold. Set one on an
                item to begin monitoring storage availability; a threshold of 0
                alerts when available storage reaches zero.
              </p>
              <Link
                href="/inventory?type=quantity"
                className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200"
              >
                Browse quantity items{' '}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
        ) : result.needsRestockingCount === 0 ? (
          <div className="experience-surface experience-empty-state">
            <CircleCheck size={26} aria-hidden="true" />
            <div>
              <h3 className="font-semibold">
                Monitored items need no restocking
              </h3>
              <p className="experience-muted mt-1 text-sm">
                {countLabel(
                  result.configuredCount,
                  'monitored active quantity item',
                )}{' '}
                {result.configuredCount === 1 ? 'is' : 'are'} above{' '}
                {result.configuredCount === 1
                  ? 'its alert threshold'
                  : 'their alert thresholds'}
                . Other inventory may have no threshold.
              </p>
              <Link
                href="/inventory?type=quantity"
                className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200"
              >
                Browse quantity items{' '}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="experience-surface overflow-hidden">
              {result.rows.map((row) => (
                <li key={row.id} className="experience-attention-row">
                  <div className="min-w-0">
                    <Link
                      href={'/inventory/quantity/' + row.id}
                      className="block truncate text-sm font-semibold"
                    >
                      {row.name}
                    </Link>
                    <p className="experience-muted mt-1 truncate text-xs">
                      {row.categoryName} ·{' '}
                      <Link
                        href={'/inventory/quantity/' + row.id}
                        className="text-cyan-200"
                      >
                        View item and locations
                      </Link>
                    </p>
                  </div>
                  <p className="experience-attention-metrics">
                    Available <strong>{row.availableQuantity}</strong> ·
                    Assigned <strong>{row.assignedQuantity}</strong>
                    <br />
                    Total <strong>{row.ownedQuantity}</strong> · Threshold{' '}
                    <strong>{row.reorderThreshold}</strong>
                  </p>
                  <strong
                    className="experience-status"
                    data-state={row.stockState}
                  >
                    {row.stockState === 'out_of_stock'
                      ? 'Out of stock'
                      : 'Needs restocking'}
                  </strong>
                </li>
              ))}
            </ul>
            <Pagination result={result} base="/dashboard" params={params} />
          </>
        )}
      </section>
      <p className="experience-muted max-w-3xl text-xs leading-5">
        Restocking includes available storage across all locations, including
        inactive ones. Assigned site holdings remain recorded equipment, but
        cannot be issued from storage. Out of stock is included in needs
        restocking.
      </p>
    </div>
  );
}
