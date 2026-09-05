import { getHistory, getLocations } from '@/features/inventory/queries.server';
import {
  HistoryList,
  Pagination,
  field,
  panel,
} from '@/features/inventory/components/read-ui';
import { Button } from '@/components/ui/button';
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
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
          <div>
            <label htmlFor="history-location">Location</label>
            <select
              className={field}
              id="history-location"
              name="location"
              defaultValue={params.location ?? ''}
            >
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.code}>
                  {location.breadcrumb}
                </option>
              ))}
            </select>
          </div>
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
