import {
  getHistory,
  getHistoryRecord,
  getLocations,
} from '@/features/inventory/queries.server';
import { readFilters } from '@/features/inventory/read-model';
import { pageRecoveryHref } from '@/features/inventory/scope-presentation';
import { countLabel } from '@/lib/count';
import {
  HistoryList,
  Pagination,
  field,
  panel,
} from '@/features/inventory/components/read-ui';
import { Button } from '@/components/ui/button';
import { LocationPicker } from '@/features/locations/location-picker';
import { getEventCustomPage } from '@/features/metadata/queries.server';
import { notFound, redirect } from 'next/navigation';
import Form from 'next/form';
import Link from 'next/link';
import styles from '@/features/inventory/components/inventory-visual.module.css';
const canonicalId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  if (params.event !== undefined) {
    const event = /^(quantity|asset):([0-9a-f-]+)$/.exec(params.event);
    if (!event || !canonicalId.test(event[2])) notFound();
    const kind = event[1] as 'quantity' | 'asset';
    const side = params.side ?? 'before';
    if (side !== 'before' && side !== 'after') notFound();
    if (params.field && !canonicalId.test(params.field)) notFound();
    const optionOffset =
      params.optionOffset === undefined ? 0 : Number(params.optionOffset);
    if (
      !Number.isSafeInteger(optionOffset) ||
      optionOffset < 0 ||
      optionOffset > 1000 ||
      optionOffset % 16 !== 0
    )
      notFound();
    const custom = await getEventCustomPage({
      kind,
      eventId: event[2],
      side,
      fieldId: params.field,
      optionOffset,
    });
    const link = (
      nextSide: 'before' | 'after',
      fieldId?: string | null,
      offset = 0,
    ) =>
      `/history?event=${kind}:${event[2]}&side=${nextSide}` +
      (fieldId ? `&field=${fieldId}` : '') +
      (offset ? `&optionOffset=${offset}` : '');
    return (
      <>
        <h1 className="text-3xl font-semibold">Custom metadata at event</h1>
        <p className="my-4 text-slate-400">
          Append-only {kind} event {event[2]}. Values and revision provenance
          come from the recorded snapshot.
        </p>
        <p>
          <a className="text-cyan-300 underline" href="/history">
            Back to history
          </a>
        </p>
        <nav className="my-4 flex gap-5" aria-label="Event snapshot side">
          <a
            className="text-cyan-300 underline"
            href={link('before', custom.field_id)}
          >
            Before event
          </a>
          <a
            className="text-cyan-300 underline"
            href={link('after', custom.field_id)}
          >
            After event
          </a>
        </nav>
        {custom.field_id ? (
          <section className={panel} aria-label="Custom history field">
            <h2 className="text-xl font-semibold">
              {custom.label} {custom.legacy ? '(legacy)' : ''}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {side === 'before' ? 'Before' : 'After'} · field {custom.field_id}
            </p>
            {custom.present ? (
              <>
                <p className="mt-2 text-sm">Type: {custom.field_type}</p>
                <p className="mt-2 text-sm">
                  Validated revision: {custom.validated_revision_id}
                </p>
                <p className="mt-2 text-sm">
                  Field owner category: {custom.owner_category_id}
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-all text-sm">
                  {JSON.stringify(custom.value)}
                </pre>
                {custom.option_paths.length > 0 && (
                  <ol className="mt-3 list-inside list-decimal space-y-1 text-sm">
                    {custom.option_paths.map((path, index) => (
                      <li key={index}>{path.join(' / ')}</li>
                    ))}
                  </ol>
                )}
                {custom.option_offset && custom.option_offset > 0 && (
                  <a
                    className="mr-4 text-cyan-300 underline"
                    href={link(
                      side,
                      custom.field_id,
                      Math.max(0, custom.option_offset - 16),
                    )}
                  >
                    Previous option paths
                  </a>
                )}
                {custom.next_option_offset !== null && (
                  <a
                    className="text-cyan-300 underline"
                    href={link(
                      side,
                      custom.field_id,
                      custom.next_option_offset,
                    )}
                  >
                    Next option paths
                  </a>
                )}
              </>
            ) : (
              <p className="mt-3">Field absent in this snapshot.</p>
            )}
            {custom.next_field_id && (
              <p className="mt-5">
                <a
                  className="text-cyan-300 underline"
                  href={link(side, custom.next_field_id)}
                >
                  Next custom field
                </a>
              </p>
            )}
          </section>
        ) : (
          <p className={panel}>
            No custom values were recorded for this event.
          </p>
        )}
      </>
    );
  }
  const filter = readFilters(params);
  const record =
    params.entityId !== undefined
      ? await getHistoryRecord(params.entityId)
      : null;
  const coherentParams = { ...params, type: record?.kind ?? filter.type };
  const clearQuery = new URLSearchParams();
  if (coherentParams.type !== 'all')
    clearQuery.set('type', coherentParams.type);
  if (filter.location) clearQuery.set('location', filter.location);
  const clearHref = '/history' + (clearQuery.size ? '?' + clearQuery : '');
  if (params.entityId !== undefined && !record) {
    return (
      <>
        <h1 className="experience-heading">Inventory history</h1>
        <div className={panel}>
          <p>
            Record history is unavailable. The record may be missing,
            inaccessible, or the record filter may be invalid.
          </p>
          <Link
            className="inline-flex min-h-11 items-center text-cyan-300 underline"
            href={clearHref}
          >
            Clear record filter
          </Link>
        </div>
      </>
    );
  }
  const [result, locations] = await Promise.all([
    getHistory(coherentParams),
    getLocations(),
  ]);
  const recovery = pageRecoveryHref('/history', coherentParams, result);
  if (recovery) redirect(recovery);
  return (
    <>
      <p className="experience-eyebrow">Inventory · Audit trail</p>
      <h1 className="experience-heading mt-3">Inventory history</h1>
      <p className="experience-muted my-4 max-w-2xl text-sm">
        Append-only records of inventory changes. Physical movements and record
        corrections are shown separately.
      </p>
      <Form
        action="/history"
        className={panel + ' mb-5 space-y-3'}
        aria-label="Filter history"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="history-type">Tracking type</label>
            <select
              key={`${record?.id ?? 'all'}:${coherentParams.type}`}
              className={field}
              id="history-type"
              name="type"
              defaultValue={
                coherentParams.type === 'all' ? '' : coherentParams.type
              }
              disabled={Boolean(record)}
              aria-describedby={record ? 'history-type-help' : undefined}
            >
              <option value="">All types</option>
              <option value="quantity">Quantity items</option>
              <option value="asset">Individual assets</option>
            </select>
            {record && (
              <>
                <input type="hidden" name="type" value={record.kind} />
                <p
                  id="history-type-help"
                  className="mt-2 text-sm text-slate-400"
                >
                  Tracking type is locked to this record. Clear the record
                  filter to choose another type.
                </p>
              </>
            )}
          </div>
          <LocationPicker
            key={params.location ?? ''}
            id="history-location"
            label="Location"
            locations={locations}
            mode="browse"
            name="location"
            defaultValue={params.location ?? ''}
            allowAll
          />
        </div>
        {record && (
          <>
            <input type="hidden" name="entityId" value={record.id} />
            <p className="text-sm text-slate-400">
              Record:{' '}
              <Link
                className="text-cyan-300 underline"
                href={
                  '/inventory/' +
                  (record.kind === 'quantity' ? 'quantity' : 'assets') +
                  '/' +
                  record.id
                }
              >
                {record.name}
              </Link>{' '}
              ·{' '}
              {record.kind === 'quantity'
                ? 'Quantity item'
                : 'Individual asset'}
              .{' '}
              <Link className="text-cyan-300 underline" href={clearHref}>
                Clear record filter
              </Link>
            </p>
            {params.type && params.type !== record.kind && (
              <p role="status" className="text-sm text-amber-100">
                Tracking type was reconciled to{' '}
                {record.kind === 'quantity'
                  ? 'Quantity items'
                  : 'Individual assets'}{' '}
                for this record.
              </p>
            )}
          </>
        )}
        <Button type="submit">Filter history</Button>
      </Form>
      {filter.location && (
        <p className="mb-3 text-sm text-slate-300">
          Location:{' '}
          {locations.find((location) => location.code === filter.location)
            ?.breadcrumb ?? filter.location}{' '}
          ·{' '}
          <Link
            className="text-cyan-300 underline"
            href={
              '/history?' +
              new URLSearchParams(
                Object.fromEntries(
                  Object.entries(coherentParams).filter(
                    ([key, value]) =>
                      key !== 'location' &&
                      key !== 'page' &&
                      value !== undefined,
                  ) as [string, string][],
                ),
              )
            }
          >
            Clear location filter
          </Link>
        </p>
      )}
      <p className="experience-muted mb-3 text-sm">
        {countLabel(result.total, 'matching event')}
      </p>
      <div className={styles.history}>
        <HistoryList events={result.rows} />
      </div>
      <Pagination result={result} base="/history" params={coherentParams} />
    </>
  );
}
