import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { getSites } from '@/features/custody/queries.server';
import { SiteManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageSitesPage() {
  const { member } = await requireMember();
  const sites = await getSites();
  return (
    <>
      <Link href="/settings" className="text-cyan-300 underline">
        Settings
      </Link>
      <h1 className="my-4 text-3xl font-semibold">Manage sites</h1>
      {member.role === 'staff' && member.can_manage_configuration ? (
        <SiteManagementForm />
      ) : (
        <p className={panel}>
          Site settings are read-only. An active staff configuration maintainer
          can create or edit sites.
        </p>
      )}
      <ul className="mt-6 space-y-2">
        {sites.map((site) => (
          <li key={site.id}>
            <Link
              className="text-cyan-300 underline"
              href={`/settings/sites/${encodeURIComponent(site.code)}`}
            >
              {site.name} ({site.code})
            </Link>{' '}
            · {site.active ? 'Active' : 'Archived'}
          </li>
        ))}
      </ul>
    </>
  );
}
