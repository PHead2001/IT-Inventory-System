import { ShowInRoom } from '@/features/room/show-in-room';
import Link from 'next/link';
import type {
  HistoryEvent,
  InventoryResult,
  LocationRef,
  PageResult,
} from '../contracts-ui';
export const panel = 'rounded-xl border border-slate-800 bg-slate-900/50 p-5';
export const field =
  'min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm';
export function LocationLink({ location }: { location: LocationRef }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <Link
        className="break-words text-cyan-300 underline"
        href={'/locations/' + encodeURIComponent(location.code)}
      >
        {location.breadcrumb} <span className="text-xs">({location.code})</span>
      </Link>
      <ShowInRoom code={location.code} />
    </span>
  );
}
export function InventoryRows({ rows }: { rows: InventoryResult[] }) {
  if (!rows.length)
    return <p className={panel}>No inventory matches these filters.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.kind + row.id + (row.location?.id ?? '')}
          className={panel}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                className="break-words text-lg font-semibold text-cyan-200 underline"
                href={
                  '/inventory/' +
                  (row.kind === 'quantity' ? 'quantity' : 'assets') +
                  '/' +
                  row.id
                }
              >
                {row.name}
              </Link>
              <p className="mt-1 text-sm text-slate-400">
                {row.categoryName} ·{' '}
                {row.kind === 'quantity'
                  ? 'Quantity inventory'
                  : 'Serialized asset'}{' '}
                · {row.status}
              </p>
              {row.kind === 'quantity' &&
                row.status === 'active' &&
                (row.stockState === 'needs_restocking' ||
                  row.stockState === 'out_of_stock') && (
                  <p className="mt-2 text-sm font-medium text-amber-200">
                    {row.stockState === 'out_of_stock'
                      ? 'Out of stock'
                      : 'Needs restocking'}{' '}
                    · Item-wide total {row.recordedTotal} / threshold{' '}
                    {row.reorderThreshold}
                  </p>
                )}
            </div>
            <span>
              {row.kind === 'quantity'
                ? (row.quantity ?? 0) + ' units'
                : row.assetTag || 'Untagged'}
            </span>
          </div>
          {row.serialNumber && (
            <p className="mt-2 break-all text-sm">Serial: {row.serialNumber}</p>
          )}
          {row.customSummary && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">
              {row.customSummary}
            </p>
          )}
          <p className="mt-3 text-sm">
            {row.location ? (
              <LocationLink location={row.location} />
            ) : (
              'No positive stock — unlocated definition'
            )}
          </p>
        </li>
      ))}
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
};
export function HistoryList({ events }: { events: HistoryEvent[] }) {
  if (!events.length)
    return <p className={panel}>No history matches these filters.</p>;
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.kind + event.id} className={panel}>
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-semibold">
              {eventNames[event.eventType] ?? event.eventType}
            </h3>
            <time className="text-sm text-slate-400" dateTime={event.at}>
              {new Date(event.at).toLocaleString('en-US', { timeZone: 'UTC' })}{' '}
              UTC
            </time>
          </div>
          <p className="mt-2 text-sm">
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
          {event.eventType !== 'metadata_updated' && event.fromLocation && (
            <p className="mt-2 text-sm">
              From: <LocationLink location={event.fromLocation} />
            </p>
          )}
          {event.eventType !== 'metadata_updated' && event.toLocation && (
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
