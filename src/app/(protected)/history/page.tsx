import { getHistory, getLocations } from '@/features/inventory/queries.server';
import {
  HistoryList,
  Pagination,
  field,
  panel,
} from '@/features/inventory/components/read-ui';
import { Button } from '@/components/ui/button';
import { LocationPicker } from '@/features/locations/location-picker';
import { getEventCustomPage } from '@/features/metadata/queries.server';
import { notFound } from 'next/navigation';
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
  const [result, locations] = await Promise.all([
    getHistory(params),
    getLocations(),
  ]);
  return (
    <>
      <h1 className="text-3xl font-semibold">Inventory history</h1>
      <p className="my-4 text-slate-400">
        Append-only records of inventory changes. Physical movements and record
        corrections are shown separately.
      </p>
      <form className={panel + ' mb-5 space-y-3'} aria-label="Filter history">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="history-type">Tracking type</label>
            <select
              className={field}
              id="history-type"
              name="type"
              defaultValue={params.type ?? ''}
            >
              <option value="">All types</option>
              <option value="quantity">Quantity</option>
              <option value="asset">Serialized assets</option>
            </select>
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
        {params.entityId && (
          <>
            <input type="hidden" name="entityId" value={params.entityId} />
            <p className="text-sm text-slate-400">
              Showing history for the selected inventory record.{' '}
              <a className="text-cyan-300 underline" href="/history">
                Clear record filter
              </a>
            </p>
          </>
        )}
        <Button type="submit">Filter history</Button>
      </form>
      <HistoryList events={result.rows} />
      <Pagination result={result} base="/history" params={params} />
    </>
  );
}
