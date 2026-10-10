import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { requireMember } from '@/lib/auth/session.server';
import { getSites } from '@/features/custody/queries.server';
import { SiteManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageSitesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const { member } = await requireMember();
  const sites = await getSites();
  return (
    <RouteReady {...await routeReadyProps('/settings/sites', searchParams)}>
      <>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
        >
          Settings
        </Link>
        <p className="experience-eyebrow mt-3">Configuration / Sites</p>
        <h1 className="experience-heading mb-5">Properties & sites</h1>
        {member.role === 'staff' && member.can_manage_configuration ? (
          <SiteManagementForm key={member.user_id} actorId={member.user_id} />
        ) : (
          <p className={panel}>
            Site settings are read-only. An active staff configuration
            maintainer can create or edit sites.
          </p>
        )}
        <ul className="experience-surface mt-5 divide-y divide-slate-700/70 overflow-hidden p-0">
          {sites.map((site) => (
            <li
              key={site.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5"
            >
              <Link
                className="min-w-0 break-words font-medium text-cyan-200 underline decoration-cyan-400/50 underline-offset-2"
                href={`/settings/sites/${encodeURIComponent(site.code)}`}
              >
                {site.name} ({site.code})
              </Link>
              <span className="text-xs font-medium text-slate-300">
                {site.active ? 'Active' : 'Archived'}
              </span>
            </li>
          ))}
        </ul>
      </>
    </RouteReady>
  );
}
