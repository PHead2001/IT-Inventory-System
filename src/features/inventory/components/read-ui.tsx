import { ShowInRoom } from '@/features/room/show-in-room';
import Link from 'next/link';
import { Box } from 'lucide-react';
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
export function LocationLink({ location }: { location: LocationRef }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <Link
        className="break-words text-cyan-300 underline"
        href={'/locations/' + encodeURIComponent(location.code)}
      >
        {location.breadcrumb} <span className="text-xs">({location.code})</span>
      </Link>
      <ShowInRoom location={location} />
    </span>
  );
}
export function InventoryRows({
  rows,
  fileSummaries = [],
}: {
  rows: InventoryResult[];
  fileSummaries?: FileListSummary[];
}) {
  if (!rows.length)
    return <p className={panel}>No inventory matches these filters.</p>;
  return (
    <ul className={`experience-surface ${styles.list}`}>
      {rows.map((row) => {
        const summary = fileSummaries.find(
          (item) => item.kind === row.kind && item.id === row.id,
        );
        return (
          <li
            key={
              row.kind +
              row.id +
              (row.location?.id ?? '') +
              (row.site?.id ?? '')
            }
            className={styles.row}
          >
            <div className={styles.rowGrid}>
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
                  <Link
                    className={styles.name}
                    href={
                      '/inventory/' +
                      (row.kind === 'quantity' ? 'quantity' : 'assets') +
                      '/' +
                      row.id
                    }
                  >
                    {row.name}
                  </Link>
                  <p className={styles.meta}>
                    {row.categoryName} ·{' '}
                    {row.kind === 'quantity'
                      ? 'Quantity inventory'
                      : 'Serialized asset'}{' '}
                    · <span className={styles.status}>{row.status}</span>
                  </p>
                  {row.kind === 'quantity' && row.itemCode && (
                    <p className={styles.meta}>
                      Item code (SKU): {row.itemCode}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.metric}>
                <span className={styles.label}>
                  {row.kind === 'quantity' ? 'This holding' : 'Asset tag'}
                </span>
                <strong>
                  {row.kind === 'quantity'
                    ? (row.quantity ?? 0) + ' units'
                    : row.assetTag || 'Untagged'}
                </strong>
                {row.kind === 'quantity' &&
                  row.availableQuantity !== undefined && (
                    <span className={styles.meta}>
                      Available {row.availableQuantity} · Assigned{' '}
                      {row.assignedQuantity} · Total recorded{' '}
                      {row.ownedQuantity}
                    </span>
                  )}
              </div>
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
                    {row.status === 'retired' ? 'Last recorded storage: ' : ''}
                    <LocationLink location={row.location} />
                  </>
                ) : (
                  'No positive stock or active site holding — unlocated definition'
                )}
              </div>
            </div>
            <div className={styles.footer}>
              {row.serialNumber && (
                <span className="[overflow-wrap:anywhere]">
                  Serial: {row.serialNumber}
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
              {row.customSummary && (
                <span className="min-w-0 basis-full">
                  <span className={styles.summary}>{row.customSummary}</span>
                  <Link
                    href={
                      '/inventory/' +
                      (row.kind === 'quantity' ? 'quantity' : 'assets') +
                      '/' +
                      row.id
                    }
                  >
                    Full details
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
        {result.total} results · Page {result.page} of {pages}
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
const eventNames: Record<string, string> = {
  created: 'Created',
  received: 'Stock received',
  moved: 'Physically moved',
  adjusted: 'Physical count corrected',
  metadata_updated: 'Metadata edited',
  archived: 'Definition archived',
  restored: 'Restored',
  location_corrected: 'Recorded location corrected',
  retired: 'Asset retired',
  site_opened: 'Site opening recorded',
  site_issued: 'Issued to site',
  site_assigned: 'Assigned to site',
  site_returned: 'Returned from site',
  site_transferred: 'Transferred between sites',
  site_corrected: 'Site custody corrected',
  site_written_off: 'Written off at site',
  site_retired: 'Retired at site',
};
export function HistoryList({ events }: { events: HistoryEvent[] }) {
  if (!events.length)
    return <p className={panel}>No history matches these filters.</p>;
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li
          key={event.kind + event.id}
          className={`${panel} min-w-0 [overflow-wrap:anywhere]`}
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-semibold">
              {eventNames[event.eventType] ?? event.eventType}
            </h3>
            <time className="text-sm text-slate-400" dateTime={event.at}>
              {new Date(event.at).toLocaleString('en-US', { timeZone: 'UTC' })}{' '}
              UTC
            </time>
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
          {event.reason && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              Reason: {event.reason}
            </p>
          )}
          {event.assignment && (
            <div className="mt-3 space-y-1 text-sm">
              <p className="min-w-0 [overflow-wrap:anywhere]">
                Custody: {event.assignment.from.label ?? 'No recorded source'}
                {' → '}
                {event.assignment.to.label ?? 'No recorded destination'}
              </p>
              {event.assignment.quantity !== null && (
                <p>Custody quantity: {event.assignment.quantity} units</p>
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
                {event.lines
                  .reduce((total, line) => total + BigInt(-line.delta), 0n)
                  .toLocaleString('en-US')}{' '}
                units across {event.lines.length} locations.
              </p>
            )}
          {!event.assignment &&
            event.eventType !== 'metadata_updated' &&
            event.fromLocation && (
              <p className="mt-2 text-sm">
                From: <LocationLink location={event.fromLocation} />
              </p>
            )}
          {!event.assignment &&
            event.eventType !== 'metadata_updated' &&
            event.toLocation && (
              <p className="mt-2 text-sm">
                To: <LocationLink location={event.toLocation} />
              </p>
            )}
          {event.lines.map((line) => (
            <p className="mt-2 text-sm" key={line.location.id}>
              <LocationLink location={line.location} />: {line.before} →{' '}
              {line.after} units ({line.delta > 0 ? '+' : ''}
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
                    {change.before || 'Not set'} → {change.after || 'Not set'}
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
        </li>
      ))}
    </ol>
  );
}
