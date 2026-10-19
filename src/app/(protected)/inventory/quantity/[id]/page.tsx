import {
  InventoryCaptureGroup,
  InventoryCaptureRegion,
} from '@/components/experience/inventory-capture-region';
import { InventoryBackLink } from '@/components/experience/record-transition';
import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { PrivateDocumentTitle } from '@/components/auth/private-document-title';
import { RecordName } from '@/components/record-name';
import {
  RecordDescription,
  RecordTextDisclosure,
} from '@/components/record-description';
import { readQuantityPage } from './read.server';
import { recordTitle } from '@/app/(protected)/record-title';
export function generateMetadata() {
  return recordTitle('Quantity item');
}
import { custodyEventLabel } from '@/features/custody/vocabulary';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { RecordStatus } from '@/components/record-status';
import Link from '@/components/experience/route-link';
import { recordDetailReturnPath } from '@/features/inventory/detail-return';
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
import { getInventoryFileCards } from '@/features/files/cards.server';
import {
  HistoryList,
  LocationLink,
  panel,
} from '@/features/inventory/components/read-ui';
import styles from '@/features/inventory/components/inventory-visual.module.css';
import { DetailRoomPreview } from '@/features/room/detail-room-preview';
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
  const returnTo = recordDetailReturnPath(query?.returnTo);
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
    initialFiles,
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
    getInventoryFileCards('quantity', id),
  ]);
  const readiness = await routeReadyProps(
    '/inventory/quantity/' + encodeURIComponent(id),
    searchParams,
  );
  return (
    <ProtectedPrivacyContent routeKey={readiness.routeKey}>
      <RouteReady
        {...readiness}
        pairedInventory
        conventionalPrimary
        capture="regions"
      >
        <PrivateDocumentTitle
          routePath={`/inventory/quantity/${encodeURIComponent(id)}`}
          title={recordTitle(detail.item.name).title.absolute}
        />
        <>
          <InventoryCaptureRegion region="header">
            <section
              className={`experience-surface-bright ${styles.detailHero}`}
            >
              <InventoryBackLink
                record={{ kind: 'quantity', id: item.id }}
                href={returnTo}
                className="text-sm text-cyan-200 underline"
              >
                ←{' '}
                {returnTo === '/inventory'
                  ? 'Back to inventory'
                  : 'Back to results'}
              </InventoryBackLink>
              <div className={`${styles.detailHead} mt-4`}>
                <div className={styles.detailTitle}>
                  <p className="experience-eyebrow">
                    {item.categoryName} · Quantity item
                  </p>
                  <RecordName
                    name={item.name}
                    record={{ kind: 'quantity', id: item.id }}
                  />
                  <p className="experience-muted mt-2 text-sm">
                    <RecordStatus
                      status={item.archived ? 'archived' : 'active'}
                    />
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
                  · available in storage {stockSummary.availableQuantity} /
                  threshold {stockSummary.reorderThreshold}
                </p>
              )}
              {stockSummary.stockState === 'in_stock' && (
                <p className="mt-3 text-sm text-emerald-200">
                  Above threshold (available in storage{' '}
                  {stockSummary.availableQuantity})
                </p>
              )}
            </section>
          </InventoryCaptureRegion>
          <InventoryCaptureRegion region="body">
            <section className={panel + ' my-5'}>
              <h2 className="font-semibold">Item details</h2>
              <div className="mt-2">
                <RecordDescription description={item.description} />
              </div>
              <div className="mt-2 text-slate-400">
                <RecordTextDisclosure
                  text={`Manufacturer: ${item.manufacturer || 'Not set'} · Model: ${item.model || 'Not set'}`}
                  label="manufacturer and model"
                  lines={1}
                />
              </div>
            </section>
          </InventoryCaptureRegion>
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
          <DetailRoomPreview
            locations={locations}
            choices={balances
              .filter((balance) => balance.quantity > 0)
              .map((balance) => ({
                code: balance.location.code,
                label:
                  balance.location.breadcrumb +
                  ' · ' +
                  countLabel(balance.quantity, 'unit'),
              }))}
            context={
              item.archived
                ? 'Archived item: recorded positive stock locations are shown.'
                : undefined
            }
          />
          <InventoryCaptureGroup region="record-supporting-content">
            <div className={styles.recordGrid}>
              <div className={styles.recordMain}>
                <CustomMetadataList
                  definition={forms[item.categoryId]?.published_definition}
                  kind="quantity"
                  values={item.customDisplay}
                  needsMetadata={item.needsMetadata}
                />
                <section className="my-6">
                  <h2 className="mb-3 text-xl font-semibold">
                    Current stock — {stockSummary.availableQuantity} available
                    in storage
                  </h2>
                  <p className="mb-3 text-sm text-slate-400">
                    {stockSummary.assignedQuantity} assigned to sites ·{' '}
                    {stockSummary.ownedQuantity} total recorded across storage
                    and sites. Inactive storage remains included in availability
                    until moved.
                  </p>
                  {balances.some((b) => b.quantity > 0) ? (
                    <ul className="space-y-3">
                      {balances
                        .filter((b) => b.quantity > 0)
                        .map((b) => (
                          <li className={panel} key={b.location.id}>
                            <LocationLink location={b.location} />
                            <p className="mt-2">
                              {countLabel(b.quantity, 'unit')}
                            </p>
                            {!b.location.active && (
                              <p className="mt-1 text-sm text-amber-200">
                                Inactive location: existing stock remains
                                recorded and can be evacuated.
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
              <aside
                className={styles.recordAside}
                aria-label="Record attachments"
              >
                <FilesPanel
                  initialState={initialFiles}
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
          </InventoryCaptureGroup>
        </>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
import { OperationalTimestamp } from '@/components/operational-time';
