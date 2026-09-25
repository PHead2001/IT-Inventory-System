import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { getSite, getSiteDetail } from '@/features/custody/queries.server';
import { panel, Pagination } from '@/features/inventory/components/read-ui';
import { SiteManagementForm } from '@/features/custody/management-form';

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    from?: string;
    until?: string;
    page?: string;
    q?: string;
    kind?: string;
    searchField?: string;
  }>;
}) {
  const { member } = await requireMember();
  const { code } = await params;
  const site = await getSite(code);
  if (!site) notFound();
  const filters = await searchParams;
  const detail = await getSiteDetail(site.id, filters);
  return (
    <>
      <Link href="/sites" className="text-cyan-300 underline">
        All sites
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{site.name}</h1>
      <p className="mt-2 text-slate-400">
        {site.code} · {site.active ? 'Active' : 'Archived'} · No room model
      </p>
      {site.notes && (
        <p className="mt-3 whitespace-pre-wrap break-words">{site.notes}</p>
      )}
      {member.role === 'staff' && site.active && (
        <div className="my-4 flex flex-wrap gap-4 text-cyan-300 underline">
          <Link href={`/sites/${encodeURIComponent(code)}/open/quantity`}>
            Record existing quantity holding
          </Link>
          <Link href={`/sites/${encodeURIComponent(code)}/open/asset`}>
            Record existing serialized asset
          </Link>
        </div>
      )}
      <div className="my-3 flex flex-wrap gap-4 text-sm text-cyan-300 underline">
        <Link href={`/inventory?site=${site.id}`}>
          View site holdings in inventory
        </Link>
        <a href={`/api/exports/inventory?site=${site.id}`}>
          Download current site holdings CSV
        </a>
      </div>
      <dl className="my-5 grid gap-3 sm:grid-cols-2">
        <div className={panel}>
          <dt>Current assigned quantity units</dt>
          <dd className="text-2xl font-semibold">
            {detail.summary.current_quantity_units}
          </dd>
        </div>
        <div className={panel}>
          <dt>Current serialized assets</dt>
          <dd className="text-2xl font-semibold">
            {detail.summary.current_serialized_assets}
          </dd>
        </div>
      </dl>
      <section className="my-6 space-y-3" aria-label="Grouped current holdings">
        <h2 className="text-xl font-semibold">
          By category, product, and model
        </h2>
        {detail.groups.rows.length ? (
          <ul className="space-y-2">
            {detail.groups.rows.map((group) => (
              <li
                className={panel}
                key={`${group.inventory_kind}:${group.category_name}:${group.name}:${group.model ?? ''}`}
              >
                <strong>
                  {group.category_name} · {group.name}
                </strong>{' '}
                · {group.model || 'Model not set'}
                <p className="text-sm text-slate-400">
                  {group.inventory_kind === 'quantity'
                    ? `${group.quantity_units} quantity units`
                    : `${group.serialized_devices} distinct serialized devices`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={panel}>No current holdings.</p>
        )}
        {detail.groups.total > detail.groups.rows.length && (
          <p className="text-sm text-slate-400">
            Showing the first 25 of {detail.groups.total} groups. Use the
            filtered holdings list below to find a specific product.
          </p>
        )}
      </section>
      <section aria-labelledby="holdings-heading">
        <h2 id="holdings-heading" className="mb-3 text-xl font-semibold">
          Current holdings
        </h2>
        <form className={panel + ' mb-4 grid gap-3 sm:grid-cols-3'}>
          <label className="space-y-2">
            Product or model
            <input
              name="q"
              defaultValue={filters.q ?? ''}
              maxLength={100}
              className="min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3"
            />
          </label>
          <label className="space-y-2">
            Search in
            <select
              name="searchField"
              defaultValue={filters.searchField ?? 'name'}
              className="min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3"
            >
              <option value="name">Product name</option>
              <option value="model">Model</option>
              <option value="category_name">Category</option>
            </select>
          </label>
          <label className="space-y-2">
            Tracking type
            <select
              name="kind"
              defaultValue={filters.kind ?? ''}
              className="min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3"
            >
              <option value="">All</option>
              <option value="quantity">Quantity</option>
              <option value="asset">Serialized</option>
            </select>
          </label>
          <button className="min-h-11 self-end rounded bg-cyan-700 px-4">
            Filter holdings
          </button>
        </form>
        {detail.holdings.length ? (
          <ul className="space-y-3">
            {detail.holdings.map((row) => (
              <li key={row.inventory_kind + row.entity_id} className={panel}>
                <Link
                  href={`/inventory/${row.inventory_kind === 'asset' ? 'assets' : 'quantity'}/${row.entity_id}`}
                  className="font-semibold text-cyan-300 underline"
                >
                  {row.name}
                </Link>
                <p className="mt-1 text-sm text-slate-400">
                  {row.category_name} · {row.model || 'Model not set'} ·{' '}
                  {row.inventory_kind === 'quantity'
                    ? `${row.quantity} units`
                    : '1 serialized asset'}
                </p>
                {row.inventory_kind === 'asset' && (
                  <p className="mt-1 text-sm">
                    {row.asset_tag || 'Untagged'} ·{' '}
                    {row.serial_number || 'No serial'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={panel}>No current holdings match these filters.</p>
        )}
        <Pagination
          result={{
            rows: detail.holdings,
            total: detail.holdingTotal,
            page: detail.page,
            pageSize: 25,
          }}
          base={`/sites/${encodeURIComponent(code)}`}
          params={filters}
        />
      </section>
      <section className="my-8 space-y-3" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-xl font-semibold">
          Assignment activity
        </h2>
        <p className="text-sm text-slate-400">
          Event metrics use the selected UTC date range; current holdings above
          do not.
        </p>
        <form className={panel + ' flex flex-wrap items-end gap-3'}>
          <label className="space-y-2">
            From (UTC)
            <input
              name="from"
              type="datetime-local"
              defaultValue={filters.from?.slice(0, 16)}
              className="min-h-11 rounded border border-slate-700 bg-slate-950 px-3"
            />
          </label>
          <label className="space-y-2">
            Until (UTC, exclusive)
            <input
              name="until"
              type="datetime-local"
              defaultValue={filters.until?.slice(0, 16)}
              className="min-h-11 rounded border border-slate-700 bg-slate-950 px-3"
            />
          </label>
          <button className="min-h-11 rounded bg-cyan-700 px-4">
            Filter activity
          </button>
        </form>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className={panel}>
            <dt>Storage-issued quantity units</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.quantity.gross_issued_units}
            </dd>
          </div>
          <div className={panel}>
            <dt>Returned quantity units</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.quantity.return_units}
            </dd>
          </div>
          <div className={panel}>
            <dt>Opening quantity units</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.quantity.opening_units}
            </dd>
          </div>
          <div className={panel}>
            <dt>Transferred in / out (quantity units)</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.quantity.transfer_in_units} /{' '}
              {detail.summary.quantity.transfer_out_units}
            </dd>
          </div>
          <div className={panel}>
            <dt>Written off quantity units</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.quantity.write_off_units}
            </dd>
          </div>
          <div className={panel}>
            <dt>Storage issue events (serialized)</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.serialized.gross_storage_issue_events}
            </dd>
          </div>
          <div className={panel}>
            <dt>Unique serialized assets issued</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.serialized.unique_issued_assets}
            </dd>
          </div>
          <div className={panel}>
            <dt>Opening serialized assets</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.serialized.opening_events}
            </dd>
          </div>
          <div className={panel}>
            <dt>Serialized returns / retirements</dt>
            <dd className="text-xl font-semibold">
              {detail.summary.serialized.return_events} /{' '}
              {detail.summary.serialized.retirement_events}
            </dd>
          </div>
        </dl>
        {detail.events.length ? (
          <ol className="space-y-3">
            {detail.events.map((event) => (
              <li key={event.id} className={panel}>
                <p className="font-semibold capitalize">
                  {event.kind.replaceAll('_', ' ')}
                </p>
                <p className="text-sm text-slate-400">
                  <time dateTime={event.created_at}>
                    {new Date(event.created_at).toLocaleString('en-US', {
                      timeZone: 'UTC',
                    })}{' '}
                    UTC
                  </time>{' '}
                  · {event.actor_name}
                </p>
                <p className="mt-1 text-sm">
                  {event.from_label || 'Opening / no source'} →{' '}
                  {event.to_label || 'No destination'}
                  {event.quantity ? ` · ${event.quantity} units` : ''}
                </p>
                {event.reason && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    Reason: {event.reason}
                  </p>
                )}
                {event.reference && (
                  <p className="mt-1 text-sm">Reference: {event.reference}</p>
                )}
                <Link
                  className="text-sm text-cyan-300 underline"
                  href={`/inventory/${event.asset_id ? 'assets' : 'quantity'}/${event.asset_id ?? event.item_id}`}
                >
                  View record
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className={panel}>No activity in this date range.</p>
        )}
        {detail.eventTotal > detail.events.length && (
          <p className="text-sm text-slate-400">
            Showing the latest 50 of {detail.eventTotal} events for this range.
          </p>
        )}
      </section>
      {member.role === 'staff' && member.can_manage_configuration && (
        <section className="my-8">
          <SiteManagementForm key={`${site.id}:${site.version}`} site={site} />
        </section>
      )}
    </>
  );
}
