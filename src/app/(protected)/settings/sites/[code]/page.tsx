import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { getSite } from '@/features/custody/queries.server';
import { SiteManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageSitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { member } = await requireMember();
  const { code } = await params;
  const site = await getSite(code);
  if (!site) notFound();
  return (
    <>
      <Link className="text-cyan-300 underline" href="/settings/sites">
        All site settings
      </Link>
      <h1 className="my-4 text-3xl font-semibold">Manage {site.name}</h1>
      <p className="mb-4 text-sm text-slate-300">
        {site.code} · {site.active ? 'Active' : 'Archived'}
      </p>
      {member.role === 'staff' && member.can_manage_configuration ? (
        <SiteManagementForm key={`${site.id}:${site.version}`} site={site} />
      ) : (
        <p className={panel}>This site is read-only for your account.</p>
      )}
      <Link
        className="mt-4 inline-flex min-h-11 items-center text-cyan-300 underline"
        href={`/sites/${encodeURIComponent(site.code)}`}
      >
        View site holdings
      </Link>
    </>
  );
}
