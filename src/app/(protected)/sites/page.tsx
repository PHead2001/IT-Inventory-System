import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { getSites } from '@/features/custody/queries.server';
import { panel } from '@/features/inventory/components/read-ui';

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
      (params.status === 'all' || site.active) &&
      (!query ||
        `${site.name} ${site.code} ${site.notes ?? ''}`
          .toLocaleLowerCase()
          .includes(query)),
  );
  return (
    <>
      <h1 className="text-3xl font-semibold">Properties and sites</h1>
      <p className="my-4 text-slate-400">
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
            className="min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-3"
            name="q"
            defaultValue={params.q ?? ''}
            maxLength={100}
          />
        </label>
        <label className="space-y-2">
          Status
          <select
            name="status"
            defaultValue={params.status === 'all' ? 'all' : 'active'}
            className="min-h-11 rounded border border-slate-700 bg-slate-950 px-3"
          >
            <option value="active">Active</option>
            <option value="all">All, including archived</option>
          </select>
        </label>
        <button className="min-h-11 rounded bg-cyan-700 px-4">Search</button>
      </form>
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((site) => (
            <li className={panel} key={site.id}>
              <Link
                className="text-lg font-semibold text-cyan-300 underline"
                href={'/sites/' + encodeURIComponent(site.code)}
              >
                {site.name}
              </Link>
              <p className="mt-1 text-sm text-slate-400">
                {site.code} · {site.active ? 'Active' : 'Archived'}
              </p>
              {site.notes && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
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
