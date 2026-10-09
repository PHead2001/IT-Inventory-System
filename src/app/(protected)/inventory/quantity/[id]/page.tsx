import { RecordName } from '@/components/record-name';
import { readQuantityPage } from './read.server';
import { recordTitle } from '@/app/(protected)/record-title';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await readQuantityPage(id);
  return recordTitle(detail?.item.name);
}
import { custodyEventLabel } from '@/features/custody/vocabulary';
import { RecordStatus } from '@/components/record-status';
import Link from 'next/link';
import { inventoryReturnPath } from '@/features/inventory/create-return';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { countLabel } from '@/lib/count';
import { siteCountCorrectionSummary } from '@/features/inventory/history-summary';
import {
  getQuantityArchiveReview,
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { DetailTasks } from '@/features/inventory/components/detail-tasks';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { CustomMetadataList } from '@/features/metadata/custom-metadata-list';
import {
  getSites,
  getEntitySiteHoldings,
  getEntityAssignments,
} from '@/features/custody/queries.server';
import { FilesPanel } from '@/features/files/files-panel';
import {
  HistoryList,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
import styles from '@/features/inventory/components/inventory-visual.module.css';
export default async function QuantityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { member } = await requireMember();
  const { id } = await params;
  const query = await searchParams;
  const returnTo = inventoryReturnPath(query?.returnTo);
  const detail = await readQuantityPage(id);
  if (!detail) notFound();
  const { item, balances, history, stockSummary } = detail;
  const [
    categories,
    locations,
    sites,
    siteHoldings,
    assignments,
    forms,
    archiveReview,
  ] = await Promise.all([
    getCategories(),
    getLocations(),
    getSites(),
    getEntitySiteHoldings(id),
    getEntityAssignments('quantity', id),
    getPublishedForms([item.categoryId]),
    member.role === 'staff' && !item.archived
      ? getQuantityArchiveReview(id)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <section className={`experience-surface-bright ${styles.detailHero}`}>
        <Link href={returnTo} className="text-sm text-cyan-200 underline">
          ←{' '}
          {returnTo === '/inventory' ? 'Back to inventory' : 'Back to results'}
        </Link>
        <div className={`${styles.detailHead} mt-4`}>
          <div className={styles.detailTitle}>
            <p className="experience-eyebrow">
              {item.categoryName} · Quantity item
            </p>
            <RecordName name={item.name} />
            <p className="experience-muted mt-2 text-sm">
              <RecordStatus status={item.archived ? 'archived' : 'active'} />
            </p>
            <details className="mt-2 text-xs text-slate-400">
              <summary className="min-h-11 cursor-pointer py-2">
                Technical record details
              </summary>
              <p>Record version: {item.version}</p>
            </details>
          </div>
          <div className={styles.detailActions}>
            <Link href={'/labels?quantity=' + item.id}>
              Add quantity QR label to queue
            </Link>
          </div>
        </div>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Available in storage</dt>
            <dd>{countLabel(stockSummary.availableQuantity, 'unit')}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Assigned to sites</dt>
            <dd>{countLabel(stockSummary.assignedQuantity, 'unit')}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Total recorded</dt>
            <dd>{countLabel(stockSummary.ownedQuantity, 'unit')}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Reorder threshold</dt>
            <dd>
              {stockSummary.reorderThreshold === null
                ? 'Monitoring disabled'
                : countLabel(stockSummary.reorderThreshold, 'unit')}
            </dd>
          </div>
          {item.itemCode && (
            <div className={styles.fact}>
              <dt>Item code (SKU)</dt>
              <dd className="experience-code">{item.itemCode}</dd>
            </div>
          )}
        </dl>
        {(stockSummary.stockState === 'needs_restocking' ||
          stockSummary.stockState === 'out_of_stock') && (
          <p className="mt-3 text-sm font-semibold text-amber-200">
            {stockSummary.stockState === 'out_of_stock'
              ? 'Out of stock'
              : 'Needs restocking'}{' '}
            · available in storage {stockSummary.availableQuantity} / threshold{' '}
            {stockSummary.reorderThreshold}
          </p>
        )}
        {stockSummary.stockState === 'in_stock' && (
          <p className="mt-3 text-sm text-emerald-200">
            Above threshold (available in storage{' '}
            {stockSummary.availableQuantity})
          </p>
        )}
      </section>
      {member.role === 'staff' && (
        <DetailTasks
          key={member.user_id + ':' + item.id}
          actorId={member.user_id}
          backendScope={process.env.NEXT_PUBLIC_SUPABASE_URL}
          canManageConfiguration={member.can_manage_configuration}
          item={item}
          balances={balances}
          siteHoldings={siteHoldings}
          archiveReview={archiveReview}
          categories={categories}
          locations={locations}
          sites={sites}
          forms={forms}
        />
      )}
      <div className={styles.recordGrid}>
        <div className={styles.recordMain}>
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
          <CustomMetadataList
            definition={forms[item.categoryId]?.published_definition}
            kind="quantity"
            values={item.customDisplay}
            needsMetadata={item.needsMetadata}
          />
          <section className="my-6">
            <h2 className="mb-3 text-xl font-semibold">
              Current stock — {stockSummary.availableQuantity} available in
              storage
            </h2>
            <p className="mb-3 text-sm text-slate-400">
              {stockSummary.assignedQuantity} assigned to sites ·{' '}
              {stockSummary.ownedQuantity} total recorded across storage and
              sites. Inactive storage remains included in availability until
              moved.
            </p>
            {balances.some((b) => b.quantity > 0) ? (
              <ul className="space-y-3">
                {balances
                  .filter((b) => b.quantity > 0)
                  .map((b) => (
                    <li className={panel} key={b.location.id}>
                      <LocationLink location={b.location} />
                      <p className="mt-2">{countLabel(b.quantity, 'unit')}</p>
                      {!b.location.active && (
                        <p className="mt-1 text-sm text-amber-200">
                          Inactive location: existing stock remains recorded and
                          can be evacuated.
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={panel}>No positive stock at any location.</p>
            )}
          </section>
          <section
            className="my-6 space-y-3"
            aria-label="Assigned site holdings"
          >
            <h2 className="text-xl font-semibold">
              Assigned to Properties & sites
            </h2>
            {siteHoldings.length ? (
              <ul className="space-y-3">
                {siteHoldings.map((holding) => (
                  <li className={panel} key={holding.site_id}>
                    <Link
                      className="text-cyan-300 underline"
                      href={`/sites/${encodeURIComponent(holding.site_code)}`}
                    >
                      {holding.site_name} ({holding.site_code})
                    </Link>
                    <p>
                      {countLabel(holding.quantity, 'unit')}
                      {!holding.site_active ? ' · Archived site' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={panel}>No outstanding site holdings.</p>
            )}
          </section>
        </div>
        <aside className={styles.recordAside} aria-label="Record attachments">
          <FilesPanel
            actorId={member.user_id}
            parentType="quantity"
            parentId={item.id}
            parentName={item.name}
            active={!item.archived}
            staff={member.role === 'staff'}
          />
        </aside>
      </div>
      {assignments.length > 0 && (
        <section className="my-6 space-y-3" aria-label="Custody history">
          <h2 className="text-xl font-semibold">Custody history</h2>
          {assignments.map((event) => (
            <p className={panel} key={event.id}>
              <span className="font-medium capitalize">
                {custodyEventLabel(event.kind, 'quantity')}
              </span>{' '}
              ·{' '}
              {event.kind === 'corrected'
                ? siteCountCorrectionSummary(event.from_label)
                : `${event.from_label || 'Opening'} → ${event.to_label || 'No destination'} · ${countLabel(event.quantity ?? 0, 'unit')}`}
              {' · '}
              {event.actor_name} ·{' '}
              <OperationalTimestamp value={event.created_at} />
              {event.reason && (
                <span className="mt-1 block">Reason: {event.reason}</span>
              )}
            </p>
          ))}
        </section>
      )}
      <h2 className="mb-3 text-xl font-semibold">Recent history</h2>
      <div className={styles.history}>
        <HistoryList events={history} compact linkToEvent />
      </div>
      <Link
        className="mt-4 inline-block min-h-11 py-3 text-cyan-300 underline"
        href={'/history?type=quantity&entityId=' + item.id}
      >
        View all item history
      </Link>
    </>
  );
}
import { OperationalTimestamp } from '@/components/operational-time';
