import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { countLabel } from '@/lib/count';
import {
  getSite,
  getSiteDetail,
  getSiteArchiveReview,
} from '@/features/custody/queries.server';
import {
  field,
  panel,
  Pagination,
} from '@/features/inventory/components/read-ui';
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
  const [detail, archiveReview] = await Promise.all([
    getSiteDetail(site.id, filters),
    member.role === 'staff' && member.can_manage_configuration
      ? getSiteArchiveReview(site.id)
      : Promise.resolve({ holdings: [], total: 0 }),
  ]);
  return (
    <>
      <Link
        href="/sites"
        className="inline-flex min-h-11 items-center text-cyan-300 underline"
      >
        All properties & sites
      </Link>
      <header className="experience-surface-bright mt-3 p-5 sm:p-6">
        <p className="experience-eyebrow">Site / Daily operations</p>
        <h1 className="experience-heading mt-1 break-words">{site.name}</h1>
        <p className="mt-2 break-words text-sm text-slate-300">
          {site.code} · {site.active ? 'Active' : 'Archived'} · No room model
        </p>
        {site.notes && (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
            {site.notes}
          </p>
        )}
      </header>
      {member.role === 'staff' && site.active && (
        <div className="my-4 flex flex-wrap gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20"
              href={`/sites/${encodeURIComponent(code)}/open/quantity`}
              aria-describedby="site-quantity-choice-description"
            >
              Record existing quantity item
            </Link>
            <p
              id="site-quantity-choice-description"
              className="mt-2 text-sm text-slate-300"
            >
              Track interchangeable items by count, such as cables and adapters.
            </p>
          </div>
          <div className="min-w-0 flex-1 basis-64">
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-100 hover:border-cyan-400/50"
              href={`/sites/${encodeURIComponent(code)}/open/asset`}
              aria-describedby="site-asset-choice-description"
            >
              Record existing individual asset
            </Link>
            <p
              id="site-asset-choice-description"
              className="mt-2 text-sm text-slate-300"
            >
              Track one specific device, such as a laptop or switch.
            </p>
          </div>
        </div>
      )}
      <div className="my-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-cyan-300 underline">
        <Link href={`/inventory?site=${site.id}`}>
          View site holdings in inventory
        </Link>
        <ExportLink href={`/api/exports/inventory?site=${site.id}`}>
          Download current site holdings CSV
        </ExportLink>
      </div>
      <dl className="my-5 grid gap-3 sm:grid-cols-2">
        <div className={panel}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-300">
            Current assigned quantity units
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {detail.summary.current_quantity_units}
          </dd>
        </div>
        <div className={panel}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-300">
            Current individual assets
          </dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {detail.summary.current_serialized_assets}
          </dd>
        </div>
      </dl>
      <section className="my-6 space-y-3" aria-label="Grouped current holdings">
        <h2 className="text-xl font-semibold">
          By category, product, and model
        </h2>
        {detail.groups.rows.length ? (
          <ul className="experience-surface divide-y divide-slate-700/70 overflow-hidden p-0">
            {detail.groups.rows.map((group) => (
              <li
                className="px-4 py-3 text-sm sm:px-5"
                key={`${group.inventory_kind}:${group.category_name}:${group.name}:${group.model ?? ''}`}
              >
                <strong className="break-words">
                  {group.category_name} · {group.name}
                </strong>{' '}
                · {group.model || 'Model not set'}
                <p className="mt-1 text-sm text-slate-300 tabular-nums">
                  {group.inventory_kind === 'quantity'
                    ? countLabel(String(group.quantity_units), 'quantity unit')
                    : countLabel(
                        String(group.serialized_devices),
                        'distinct serialized device',
                      )}
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
      <section id="site-holdings" aria-labelledby="holdings-heading">
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
              className={field}
            />
          </label>
          <label className="space-y-2">
            Search in
            <select
              name="searchField"
              defaultValue={filters.searchField ?? 'name'}
              className={field}
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
              className={field}
            >
              <option value="">All</option>
              <option value="quantity">Quantity items</option>
              <option value="asset">Individual assets</option>
            </select>
          </label>
          <button className="min-h-11 self-end rounded-lg bg-cyan-600 px-4 font-medium text-slate-950 hover:bg-cyan-500">
            Filter holdings
          </button>
        </form>
        {detail.holdings.length ? (
          <ul className="experience-surface divide-y divide-slate-700/70 overflow-hidden p-0">
            {detail.holdings.map((row) => (
              <li
                key={row.inventory_kind + row.entity_id}
                className="px-4 py-3 sm:px-5"
              >
                <Link
                  href={`/inventory/${row.inventory_kind === 'asset' ? 'assets' : 'quantity'}/${row.entity_id}`}
                  className="break-words font-semibold text-cyan-200 underline"
                >
                  {row.name}
                </Link>
                <p className="mt-1 break-words text-sm text-slate-300 tabular-nums">
                  {row.category_name} · {row.model || 'Model not set'} ·{' '}
                  {row.inventory_kind === 'quantity'
                    ? countLabel(row.quantity, 'unit')
                    : '1 serialized asset'}
                </p>
                {row.inventory_kind === 'asset' && (
                  <p className="mt-1 break-all text-sm text-slate-300">
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
        <p className="text-sm text-slate-300">
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
              className={field}
            />
          </label>
          <label className="space-y-2">
            Until (UTC, exclusive)
            <input
              name="until"
              type="datetime-local"
              defaultValue={filters.until?.slice(0, 16)}
              className={field}
            />
          </label>
          <button className="min-h-11 rounded-lg bg-cyan-600 px-4 font-medium text-slate-950 hover:bg-cyan-500">
            Filter activity
          </button>
        </form>
        <dl className="grid gap-2 min-[360px]:grid-cols-2 xl:grid-cols-3 [&_dd]:mt-1 [&_dd]:font-semibold [&_dd]:tabular-nums [&_dt]:text-sm [&_dt]:text-slate-300">
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
          <ol className="experience-surface divide-y divide-slate-700/70 overflow-hidden p-0">
            {detail.events.map((event) => (
              <li key={event.id} className="break-words px-4 py-3 sm:px-5">
                <p className="font-semibold capitalize">
                  {event.kind.replaceAll('_', ' ')}
                </p>
                <p className="text-sm text-slate-300">
                  <OperationalTimestamp value={event.created_at} /> ·{' '}
                  {event.actor_name}
                </p>
                <p className="mt-1 text-sm">
                  {event.from_label || 'Opening / no source'} →{' '}
                  {event.to_label || 'No destination'}
                  {event.quantity
                    ? ` · ${countLabel(event.quantity, 'unit')}`
                    : ''}
                </p>
                {event.reason && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    Reason: {event.reason}
                  </p>
                )}
                {event.reference && (
                  <p className="mt-1 break-all text-sm">
                    Ticket number reference: {event.reference}
                  </p>
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
        <details className="experience-surface my-8 p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-cyan-200">
            Manage site / Archive or restore
          </summary>
          <div className="mt-4">
            <SiteManagementForm
              key={`${member.user_id}:${site.id}`}
              actorId={member.user_id}
              site={site}
              holdings={archiveReview.holdings}
              holdingTotal={archiveReview.total}
            />
          </div>
        </details>
      )}
    </>
  );
}
import {
  OperationalTimestamp,
  ExportLink,
} from '@/components/operational-time';
