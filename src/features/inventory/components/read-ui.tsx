import { CopyTechnicalDetails } from '@/components/copy-technical-details';
import {
  historySummary,
  historyEventTitle,
  assignmentEndpointSummary,
} from '../history-summary';
import { RecordStatus } from '@/components/record-status';
import { ShowInRoom } from '@/features/room/show-in-room';
import { OperationalTimestamp } from '@/components/operational-time';
import Link from 'next/link';
import { Box } from 'lucide-react';
import type { ReactNode } from 'react';
import { countLabel } from '@/lib/count';
import {
  pageInventoryCounts,
  pageDistinctQuantityProducts,
} from '../scope-presentation';
import { inventoryRecordHref, inventoryRowAnchor } from '../create-return';
import styles from './inventory-visual.module.css';
import { InventoryListThumbnail } from '@/features/files/list-thumbnail';
import type { FileListSummary } from '@/features/files/list.server';
import type {
  HistoryEvent,
  InventoryResult,
  LocationRef,
  PageResult,
} from '../contracts-ui';
export const panel = 'experience-surface min-w-0 p-5';
export const field = 'experience-field min-h-11 w-full px-3 py-2 text-sm';
export function LocationCode({ code }: { code: string }) {
  return (
    <span
      className="experience-code block max-w-full overflow-x-auto whitespace-nowrap text-xs text-slate-400"
      role={code.length > 24 ? 'region' : undefined}
      tabIndex={code.length > 24 ? 0 : undefined}
      aria-label={code.length > 24 ? `Full location code: ${code}` : undefined}
    >
      {code}
    </span>
  );
}
export function InventoryCount({
  result,
  compact = false,
}: {
  result: PageResult<InventoryResult>;
  compact?: boolean;
}) {
  return (
    <div className="experience-muted text-sm tabular-nums">
      <p>{countLabel(result.total, 'matching row')}</p>
      {result.rows.length > 0 &&
        (!compact ||
          result.rows.length > 1 ||
          result.total > result.rows.length) && (
          <p className="mt-1 text-xs">
            On this page: {pageInventoryCounts(result.rows)}
          </p>
        )}
      {pageDistinctQuantityProducts(result.rows) > 0 &&
        (!compact ||
          result.rows.filter((row) => row.kind === 'quantity').length >
            pageDistinctQuantityProducts(result.rows)) && (
          <p className="mt-1 text-xs">
            Distinct quantity products on this page:{' '}
            {pageDistinctQuantityProducts(result.rows)} (overlaps the row
            counts).
          </p>
        )}
    </div>
  );
}
export function LocationLink({ location }: { location: LocationRef }) {
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-3">
      <Link
        className="break-words text-cyan-300 underline"
        aria-label={`${location.breadcrumb} (${location.code})`}
        href={'/locations/' + encodeURIComponent(location.code)}
      >
        {location.breadcrumb}
        {location.code.length <= 24 && (
          <>
            {' '}
            <span className="experience-code whitespace-nowrap text-xs">
              ({location.code})
            </span>
          </>
        )}
      </Link>
      {location.code.length > 24 && <LocationCode code={location.code} />}
      <ShowInRoom location={location} />
    </span>
  );
}
export function InventoryRows({
  rows,
  fileSummaries = [],
  emptyState,
  returnTo,
  currentLocationId,
}: {
  rows: InventoryResult[];
  fileSummaries?: FileListSummary[];
  emptyState?: ReactNode;
  returnTo?: string;
  currentLocationId?: string;
}) {
  if (!rows.length)
    return (
      emptyState ?? <p className={panel}>No inventory matches these filters.</p>
    );
  return (
    <ul className={`experience-surface ${styles.list}`}>
      {rows.map((row, index) => {
        const summary = fileSummaries.find(
          (item) => item.kind === row.kind && item.id === row.id,
        );
        const hideCurrentLocation = Boolean(
          currentLocationId &&
          !row.site &&
          row.location?.id === currentLocationId,
        );
        const recordHref = inventoryRecordHref(
          row.kind,
          row.id,
          returnTo ? `${returnTo}#${inventoryRowAnchor(index)}` : undefined,
        );
        return (
          <li
            id={returnTo ? inventoryRowAnchor(index) : undefined}
            key={
              row.kind +
              row.id +
              (row.location?.id ?? '') +
              (row.site?.id ?? '')
            }
            className={styles.row}
          >
            <div
              className={`${styles.rowGrid}${hideCurrentLocation ? ' ' + styles.rowGridWithoutLocation : ''}`}
            >
              <div className={styles.identity}>
                <span
                  className={styles.thumbnail}
                  aria-hidden={!summary?.thumbnail_path}
                >
                  {summary?.thumbnail_path ? (
                    <InventoryListThumbnail
                      path={summary.thumbnail_path}
                      name={summary.photo_name ?? row.name}
                    />
                  ) : (
                    <Box size={24} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0">
                  <Link className={styles.name} href={recordHref}>
                    {row.name}
                  </Link>
                  <p className={styles.meta}>
                    {row.categoryName} ·{' '}
                    {row.kind === 'quantity'
                      ? 'Quantity item'
                      : 'Individual asset'}{' '}
                    · <RecordStatus status={row.status} />
                  </p>
                  {row.kind === 'quantity' && row.itemCode && (
                    <p className={styles.meta}>
                      Item code (SKU):{' '}
                      <span className="experience-code">{row.itemCode}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.metric}>
                <span className={styles.label}>
                  {row.kind === 'quantity'
                    ? row.site
                      ? 'At this site'
                      : row.location
                        ? 'At this location'
                        : 'Unlocated stock'
                    : 'Asset tag'}
                </span>
                <strong
                  className={
                    row.kind === 'asset' ? 'experience-code' : undefined
                  }
                >
                  {row.kind === 'quantity'
                    ? countLabel(row.quantity ?? 0, 'unit')
                    : row.assetTag || 'Untagged'}
                </strong>
                {row.kind === 'quantity' &&
                  row.availableQuantity !== undefined && (
                    <span className={styles.meta}>
                      <span className="block">
                        Across all storage: {row.availableQuantity} available
                      </span>
                      <span className="block">
                        Overall totals: {row.assignedQuantity} assigned ·{' '}
                        {row.ownedQuantity} recorded
                      </span>
                    </span>
                  )}
              </div>
              {!hideCurrentLocation && (
                <div className={styles.location}>
                  <span className={styles.label}>Storage / custody</span>
                  {row.site ? (
                    <Link
                      className="text-cyan-300 underline [overflow-wrap:anywhere]"
                      href={`/sites/${encodeURIComponent(row.site.code)}`}
                    >
                      Assigned to {row.site.name} ({row.site.code}) · no room
                      model
                    </Link>
                  ) : row.location ? (
                    <>
                      {row.status === 'retired'
                        ? 'Last recorded storage: '
                        : ''}
                      <LocationLink location={row.location} />
                    </>
                  ) : (
                    'No positive stock or active site holding — unlocated definition'
                  )}
                </div>
              )}
            </div>
            <div className={styles.footer}>
              {row.serialNumber && (
                <span className="[overflow-wrap:anywhere]">
                  Serial:{' '}
                  <span className="experience-code">{row.serialNumber}</span>
                </span>
              )}
              {summary &&
                (summary.photo_count > 0 || summary.document_count > 0) && (
                  <span
                    role="group"
                    aria-label={`Files for ${row.name}`}
                    className="flex flex-wrap gap-x-2"
                  >
                    <span>
                      {summary.photo_count}{' '}
                      {summary.photo_count === 1 ? 'photo' : 'photos'}
                    </span>
                    <span>
                      {summary.document_count}{' '}
                      {summary.document_count === 1 ? 'PDF' : 'PDFs'}
                    </span>
                  </span>
                )}
              {row.kind === 'quantity' &&
                row.status === 'active' &&
                (row.stockState === 'needs_restocking' ||
                  row.stockState === 'out_of_stock') && (
                  <span className={styles.alert}>
                    {row.stockState === 'out_of_stock'
                      ? 'Out of stock'
                      : 'Needs restocking'}{' '}
                    · Available in storage{' '}
                    {row.availableQuantity ?? row.recordedTotal} / threshold{' '}
                    {row.reorderThreshold}
                  </span>
                )}
              {row.customPreview && row.customPreview.answers.length > 0 && (
                <span className="min-w-0 basis-full">
                  <span className={styles.summary}>
                    {row.customPreview.answers.map((answer, index) => (
                      <span key={index} className="block">
                        {answer.label}: {answer.displayValue}
                        {answer.truncated ? '…' : ''}
                      </span>
                    ))}
                  </span>
                  <Link href={recordHref}>
                    {row.customPreview.truncated
                      ? 'View all details'
                      : 'Full details'}
                  </Link>
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
export function Pagination({
  result,
  base,
  params,
}: {
  result: PageResult<unknown>;
  base: string;
  params: Record<string, string | undefined>;
}) {
  if (result.total === 0) return null;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (page: number) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value && key !== 'page') query.set(key, value);
    });
    query.set('page', String(page));
    return base + '?' + query;
  };
  return (
    <nav
      aria-label="Pagination"
      className="mt-5 flex flex-wrap items-center gap-5 text-sm"
    >
      <span>
        Page {result.page} of {pages}
      </span>
      {result.page > 1 && (
        <Link
          className="min-h-11 py-3 text-cyan-300 underline"
          href={href(result.page - 1)}
        >
          Previous
        </Link>
      )}
      {result.page < pages && (
        <Link
          className="min-h-11 py-3 text-cyan-300 underline"
          href={href(result.page + 1)}
        >
          Next
        </Link>
      )}
    </nav>
  );
}
export function HistoryList({
  events,
  compact = false,
  linkToEvent = false,
}: {
  events: HistoryEvent[];
  compact?: boolean;
  /** Link to the immutable event identity, independent of history pagination. */
  linkToEvent?: boolean;
}) {
  const DetailTag = compact ? 'details' : 'div';
  if (!events.length)
    return <p className={panel}>No history matches these filters.</p>;
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li
          key={event.kind + event.id}
          id={`history-event-${event.kind}-${event.id}`}
          className={`${panel} min-w-0 [overflow-wrap:anywhere]`}
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-semibold">{historyEventTitle(event)}</h3>
            <OperationalTimestamp
              relative
              className="text-sm text-slate-400"
              value={event.at}
            />
          </div>
          <p className="mt-2 min-w-0 text-sm [overflow-wrap:anywhere]">
            <Link
              className="text-cyan-300 underline"
              href={
                '/inventory/' +
                (event.kind === 'quantity' ? 'quantity' : 'assets') +
                '/' +
                event.entityId
              }
            >
              {event.entityName}
            </Link>{' '}
            · {event.actorName}
          </p>
          {historySummary(event) && (
            <p className="mt-2 text-sm">{historySummary(event)}</p>
          )}
          <DetailTag>
            {compact && (
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
                View event details
              </summary>
            )}
            {event.reason && (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                Reason: {event.reason}
              </p>
            )}
            {event.assignment && (
              <div className="mt-3 space-y-1 text-sm">
                <p className="min-w-0 [overflow-wrap:anywhere]">
                  Custody:{' '}
                  {event.kind === 'quantity' &&
                  event.assignment.kind === 'corrected'
                    ? historySummary(event)
                    : assignmentEndpointSummary(event.assignment)}
                </p>
                {event.assignment.quantity !== null &&
                  !(
                    event.kind === 'quantity' &&
                    event.assignment.kind === 'corrected'
                  ) && (
                    <p>
                      Custody quantity:{' '}
                      {countLabel(event.assignment.quantity, 'unit')}
                    </p>
                  )}
                {event.assignment.reference && (
                  <p className="whitespace-pre-wrap break-words">
                    Ticket number reference: {event.assignment.reference}
                  </p>
                )}
              </div>
            )}
            {event.kind === 'quantity' &&
              event.eventType === 'archived' &&
              event.lines.length > 0 && (
                <p className="mt-2 text-sm text-amber-100">
                  Removed{' '}
                  {countLabel(
                    event.lines
                      .reduce((total, line) => total + BigInt(-line.delta), 0n)
                      .toLocaleString('en-US'),
                    'unit',
                  )}{' '}
                  across {countLabel(event.lines.length, 'location')}.
                </p>
              )}
            {!event.assignment &&
              event.eventType !== 'metadata_updated' &&
              event.fromLocation && (
                <p className="mt-2 text-sm">
                  {event.fromLocation.id === event.toLocation?.id
                    ? 'At: '
                    : 'From: '}
                  <LocationLink location={event.fromLocation} />
                </p>
              )}
            {!event.assignment &&
              event.eventType !== 'metadata_updated' &&
              event.toLocation?.id !== event.fromLocation?.id &&
              event.toLocation && (
                <p className="mt-2 text-sm">
                  To: <LocationLink location={event.toLocation} />
                </p>
              )}
            {event.lines.map((line) => (
              <p className="mt-2 text-sm" key={line.location.id}>
                <LocationLink location={line.location} />: {line.before} →{' '}
                {countLabel(line.after, 'unit')} ({line.delta > 0 ? '+' : ''}
                {line.delta})
              </p>
            ))}
            {event.metadataChanges.length > 0 && (
              <dl className="mt-3 space-y-2 text-sm">
                {event.metadataChanges.map((change) => (
                  <div key={change.field}>
                    <dt className="font-medium capitalize">
                      {change.field.replaceAll('_', ' ')}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-slate-400">
                      {change.presentation === 'code' ? (
                        <>
                          <span
                            className={
                              change.before ? 'experience-code' : undefined
                            }
                          >
                            {change.before || 'Not set'}
                          </span>{' '}
                          →{' '}
                          <span
                            className={
                              change.after ? 'experience-code' : undefined
                            }
                          >
                            {change.after || 'Not set'}
                          </span>
                        </>
                      ) : (
                        `${change.before || 'Not set'} → ${change.after || 'Not set'}`
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {event.customMetadataPresent && (
              <p className="mt-3 text-sm">
                <Link
                  className="text-cyan-300 underline"
                  href={`/history?event=${event.kind}:${event.id}`}
                >
                  {event.customMetadataChanged
                    ? 'Custom metadata changed — inspect before and after'
                    : 'Inspect custom metadata snapshots'}
                </Link>
              </p>
            )}
            <details className="mt-3 text-xs text-slate-400">
              <summary className="min-h-11 cursor-pointer py-2">
                Technical event details
              </summary>
              <CopyTechnicalDetails
                details={`Event: ${event.kind}:${event.id}\nOperation type: ${event.eventType}\nRecord: ${event.entityId}\nCustody event: ${event.assignment?.eventId ?? 'None'}\nRecorded instant: ${event.at}`}
              />
              <p>
                Record name is the current name, not a recorded name snapshot.
              </p>
              {event.assignment && (
                <>
                  <p>
                    Custody endpoint labels are recorded snapshots from this
                    event.
                  </p>
                </>
              )}
              {(event.lines.length > 0 ||
                event.fromLocation ||
                event.toLocation) && (
                <p>
                  Storage location labels are current reference labels, not
                  recorded name snapshots.
                </p>
              )}
            </details>
            {linkToEvent && (
              <Link
                className="inline-block min-h-11 py-3 text-sm text-cyan-300 underline"
                href={`/history/events/${event.kind}/${event.id}`}
              >
                Open recorded event
              </Link>
            )}
          </DetailTag>
        </li>
      ))}
    </ol>
  );
}
