'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

import { OperationalTimestamp } from '@/components/operational-time';

import { refreshDashboard } from './refresh.actions';

import type { DashboardSnapshot } from './snapshot.server';

import Link from 'next/link';

import { countLabel } from '@/lib/count';

import {
  ArrowRight,
  CircleCheck,
  Download,
  SlidersHorizontal,
} from 'lucide-react';

import { Pagination } from '@/features/inventory/components/read-ui';

export function DashboardSnapshotView({
  initialSnapshot,
  params,
}: {
  initialSnapshot: DashboardSnapshot;
  params: { page?: string };
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  const [pending, startTransition] = useTransition();

  const [failed, setFailed] = useState(false);

  const [message, setMessage] = useState('');

  const result = snapshot.result;

  function refresh() {
    startTransition(async () => {
      try {
        const response = await refreshDashboard(result.page);

        if (!response.ok) {
          setFailed(true);
          setMessage('');
          return;
        }

        setSnapshot(response.snapshot);

        setFailed(false);

        setMessage('Overview refreshed successfully.');
      } catch {
        setFailed(true);

        setMessage('');
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="experience-eyebrow">Inventory snapshot</p>

          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            Storage health
          </h2>
        </div>

        <div className="space-y-1 text-sm">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={refresh}
          >
            {pending ? 'Refreshing…' : 'Refresh overview'}
          </Button>

          <p className="experience-muted">
            Last successfully fetched:{' '}
            <OperationalTimestamp value={snapshot.fetchedAt} />
          </p>

          <p role="status" aria-live="polite">
            {pending ? 'Refreshing overview…' : message}
          </p>

          {failed && (
            <p role="alert" className="max-w-lg text-amber-100">
              Refresh failed. Showing stale data from the last successful fetch.
              Retry Refresh overview.
            </p>
          )}
        </div>
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

            <ExportLink
              href="/api/exports/inventory?export=low_stock"

              className="inline-flex min-h-11 items-center gap-1 hover:text-white"
            >
              <Download size={14} aria-hidden="true" /> Download low-stock CSV
            </ExportLink>
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

import { ExportLink } from '@/components/operational-time';
