import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import {
  getSite,
  getSiteArchiveReview,
} from '@/features/custody/queries.server';
import { SiteManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageSitePage({
  params,
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ code: string }>;
}) {
  const { member } = await requireMember();
  const { code } = await params;
  const site = await getSite(code);
  if (!site) notFound();
  const review =
    member.role === 'staff' && member.can_manage_configuration
      ? await getSiteArchiveReview(site.id)
      : { holdings: [], total: 0 };
  return (
    <ProtectedPrivacyContent>
      <RouteReady
        {...await routeReadyProps(
          '/settings/sites/' + encodeURIComponent(code),
          searchParams,
        )}
      >
        <>
          <Link
            className="inline-flex min-h-11 items-center text-cyan-300 underline"
            href="/settings/sites"
          >
            All site settings
          </Link>
          <p className="experience-eyebrow mt-3">Configuration / Site</p>
          <h1 className="experience-heading mb-2 break-words">
            Manage {site.name}
          </h1>
          <p className="mb-5 text-sm text-slate-300">
            {site.code} · {site.active ? 'Active' : 'Archived'}
          </p>
          {member.role === 'staff' && member.can_manage_configuration ? (
            <SiteManagementForm
              key={`${member.user_id}:${site.id}`}
              actorId={member.user_id}
              site={site}
              holdings={review.holdings}
              holdingTotal={review.total}
            />
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
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
