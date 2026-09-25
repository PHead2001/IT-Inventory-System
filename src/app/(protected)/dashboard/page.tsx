import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLowStockDashboard } from '@/features/inventory/queries.server';
import { Pagination, panel } from '@/features/inventory/components/read-ui';
import { RefreshButton } from '@/features/inventory/components/refresh-button';

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
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
        Storage availability · Overview
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Low-stock overview</h1>
        <RefreshButton />
      </div>
      <p className="mt-3 text-slate-400">
        Restocking uses available storage across all locations, including
        inactive ones. Assigned site holdings remain part of total recorded
        equipment, but cannot be issued from storage. Out of stock is included
        in needs restocking.
      </p>
      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className={panel}>
          <dt className="text-sm text-slate-400">Needs restocking</dt>
          <dd className="mt-1 text-3xl font-semibold text-amber-200">
            {result.needsRestockingCount}
          </dd>
        </div>
        <div className={panel}>
          <dt className="text-sm text-slate-400">Out of stock (subset)</dt>
          <dd className="mt-1 text-3xl font-semibold text-red-200">
            {result.outOfStockCount}
          </dd>
        </div>
        <div className={panel}>
          <dt className="text-sm text-slate-400">Monitored active items</dt>
          <dd className="mt-1 text-3xl font-semibold">
            {result.configuredCount}
          </dd>
        </div>
      </dl>
      <div className="my-5 flex flex-wrap gap-5 text-sm">
        <Link
          href="/inventory?lowStock=true"
          className="min-h-11 py-3 text-cyan-300 underline"
        >
          View filtered inventory
        </Link>
        <a
          href="/api/exports/inventory?export=low_stock"
          className="min-h-11 py-3 text-cyan-300 underline"
        >
          Download low-stock CSV
        </a>
      </div>
      {result.configuredCount === 0 ? (
        <p className={panel}>
          No active quantity items have a reorder threshold. Staff can set one
          on a quantity item; 0 alerts when available storage reaches zero.
        </p>
      ) : result.needsRestockingCount === 0 ? (
        <p className={panel}>No monitored items need restocking.</p>
      ) : (
        <>
          <h2 className="mb-3 text-xl font-semibold">
            Items needing attention
          </h2>
          <ul className="space-y-3">
            {result.rows.map((row) => (
              <li key={row.id} className={panel}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={'/inventory/quantity/' + row.id}
                      className="font-semibold text-cyan-200 underline"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-1 text-sm text-slate-400">
                      {row.categoryName}
                    </p>
                  </div>
                  <strong className="text-sm text-amber-200">
                    {row.stockState === 'out_of_stock'
                      ? 'Out of stock'
                      : 'Needs restocking'}
                  </strong>
                </div>
                <p className="mt-2 text-sm">
                  Available in storage: {row.availableQuantity} · Assigned to
                  sites: {row.assignedQuantity} · Total recorded:{' '}
                  {row.ownedQuantity} · Reorder threshold:{' '}
                  {row.reorderThreshold}
                </p>
                <Link
                  className="mt-2 inline-block min-h-11 py-3 text-sm text-cyan-300 underline"
                  href={'/inventory/quantity/' + row.id}
                >
                  View item and locations
                </Link>
              </li>
            ))}
          </ul>
          <Pagination result={result} base="/dashboard" params={params} />
        </>
      )}
    </>
  );
}
