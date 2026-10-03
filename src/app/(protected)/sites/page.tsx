import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { getSites } from '@/features/custody/queries.server';
import { field, panel } from '@/features/inventory/components/read-ui';

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { member } = await requireMember();
  const params = await searchParams;
  const sites = await getSites();
  const query = (params.q ?? '').trim().toLocaleLowerCase().slice(0, 100);
  const rows = sites.filter(
    (site) =>
      (params.status === 'all' ||
        (params.status === 'archived' ? !site.active : site.active)) &&
      (!query ||
        `${site.name} ${site.code} ${site.notes ?? ''}`
          .toLocaleLowerCase()
          .includes(query)),
  );
  return (
    <>
      <p className="experience-eyebrow">Inventory · Site custody</p>
      <h1 className="experience-heading mt-3">Properties and sites</h1>
      <p className="experience-muted my-4 max-w-2xl text-sm">
        Sites track deployed equipment custody. They are separate from IT
        storage locations and do not have a room model.
      </p>
      {member.role === 'staff' && member.can_manage_configuration && (
        <Link
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
          href="/settings/sites"
        >
          Manage sites
        </Link>
      )}
      <form className={panel + ' my-4 flex flex-wrap items-end gap-3'}>
        <label className="min-w-56 flex-1 space-y-2">
          Search sites
          <input
            className={field}
            name="q"
            defaultValue={params.q ?? ''}
            maxLength={100}
          />
        </label>
        <label className="space-y-2">
          Status
          <select
            name="status"
            defaultValue={
              params.status === 'all' || params.status === 'archived'
                ? params.status
                : 'active'
            }
            className={field}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All, including archived</option>
          </select>
        </label>
        <button className="min-h-11 rounded-lg bg-cyan-700 px-4 font-semibold">
          Search
        </button>
      </form>
      {rows.length ? (
        <ul className="experience-surface divide-y divide-cyan-100/10 overflow-hidden">
          {rows.map((site) => (
            <li
              className="min-w-0 p-4 transition-colors hover:bg-cyan-100/5"
              key={site.id}
            >
              <Link
                className="break-words text-base font-semibold text-cyan-100 hover:underline [overflow-wrap:anywhere]"
                href={'/sites/' + encodeURIComponent(site.code)}
              >
                {site.name}
              </Link>
              <p className="experience-muted mt-1 text-sm">
                {site.code} · {site.active ? 'Active' : 'Archived'}
              </p>
              {site.notes && (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-slate-200">
                  {site.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={panel}>No sites match these filters.</p>
      )}
    </>
  );
}
