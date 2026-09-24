import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import {
  getQuantityDetail,
  getQuantityArchiveReview,
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { OperationPanel } from '@/features/inventory/components/mutation-form';
import { ArchiveQuantityPanel } from '@/features/inventory/components/archive-quantity-form';
import {
  HistoryList,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
export default async function QuantityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { member } = await requireMember();
  const { id } = await params;
  const detail = await getQuantityDetail(id);
  if (!detail) notFound();
  const { item, balances, history, stockSummary } = detail;
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  const archiveReview =
    member.role === 'staff' && !item.archived
      ? await getQuantityArchiveReview(id)
      : null;
  return (
    <>
      <Link href="/inventory" className="text-sm text-cyan-300 underline">
        Back to inventory
      </Link>
      <h1 className="mt-4 break-words text-3xl font-semibold">{item.name}</h1>
      <Link
        href={'/labels?quantity=' + item.id}
        className="mt-3 inline-block min-h-11 py-3 text-cyan-300 underline"
      >
        Add quantity QR label to queue
      </Link>
      <p className="mt-2 text-slate-400">
        {item.categoryName} · Quantity inventory ·{' '}
        {item.archived ? 'Archived' : 'Active'} · Version {item.version}
      </p>
      <p className="mt-3 text-sm">
        Reorder threshold:{' '}
        {stockSummary.reorderThreshold === null
          ? 'Monitoring disabled'
          : stockSummary.reorderThreshold + ' units'}
        {(stockSummary.stockState === 'needs_restocking' ||
          stockSummary.stockState === 'out_of_stock') && (
          <span className="ml-2 font-medium text-amber-200">
            ·{' '}
            {stockSummary.stockState === 'out_of_stock'
              ? 'Out of stock'
              : 'Needs restocking'}{' '}
            (item-wide total {stockSummary.recordedTotal})
          </span>
        )}
        {stockSummary.stockState === 'in_stock' && (
          <span className="ml-2 text-emerald-200">
            · Above threshold (item-wide total {stockSummary.recordedTotal})
          </span>
        )}
      </p>
      <section className={panel + ' my-5'}>
        <h2 className="font-semibold">Item details</h2>
        <p className="mt-2 whitespace-pre-wrap break-words">
          {item.description || 'No description'}
        </p>
        <p className="mt-2 break-words text-sm text-slate-400">
          Manufacturer: {item.manufacturer || 'Not set'} · Model:{' '}
          {item.model || 'Not set'}
        </p>
      </section>
      <section className="my-6">
        <h2 className="mb-3 text-xl font-semibold">
          Current stock — {stockSummary.recordedTotal} units total
        </h2>
        {balances.some((b) => b.quantity > 0) ? (
          <ul className="space-y-3">
            {balances
              .filter((b) => b.quantity > 0)
              .map((b) => (
                <li className={panel} key={b.location.id}>
                  <LocationLink location={b.location} />
                  <p className="mt-2">{b.quantity} units</p>
                </li>
              ))}
          </ul>
        ) : (
          <p className={panel}>No positive stock at any location.</p>
        )}
      </section>
      {member.role === 'staff' && (
        <section aria-label="Quantity actions" className="mb-8 space-y-3">
          <h2 className="text-xl font-semibold">Manage quantity inventory</h2>
          {(item.archived
            ? (['quantity_restore'] as const)
            : ([
                'quantity_update',
                'quantity_receive',
                'quantity_move',
                'quantity_adjust',
              ] as const)
          ).map((operation) => (
            <OperationPanel
              key={operation}
              operation={operation}
              item={item}
              balances={balances}
              categories={categories}
              locations={locations}
            />
          ))}
          {archiveReview && !archiveReview.archived && (
            <ArchiveQuantityPanel review={archiveReview} />
          )}
        </section>
      )}
      <h2 className="mb-3 text-xl font-semibold">Recent history</h2>
      <HistoryList events={history} />
      <Link
        className="mt-4 inline-block min-h-11 py-3 text-cyan-300 underline"
        href={'/history?type=quantity&entityId=' + item.id}
      >
        View all item history
      </Link>
    </>
  );
}
