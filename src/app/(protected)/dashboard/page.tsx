import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { Map, ArrowRight } from 'lucide-react';
import { ClosetPreview } from '@/components/experience/closet-preview';
import { AmbientLight } from '@/components/experience/ambient-light';
import { redirect } from 'next/navigation';
import { loadDashboardSnapshot } from './snapshot.server';
import { DashboardSnapshotView } from './snapshot-view';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const snapshot = await loadDashboardSnapshot(Number(params.page ?? 1));
  const result = snapshot.result;
  if (result.page > Math.max(1, Math.ceil(result.total / result.pageSize)))
    redirect('/dashboard?page=1');
  return (
    <ProtectedPrivacyContent>
      <RouteReady {...await routeReadyProps('/dashboard', searchParams)}>
        <div className="space-y-5">
          <section className="experience-overview-hero experience-surface-bright">
            <AmbientLight />
            <div>
              <p className="experience-eyebrow">
                Storage availability · Overview
              </p>
              <h1 className="experience-heading mt-3">Low-stock overview</h1>
              <p className="experience-muted mt-3 max-w-xl text-sm leading-6">
                Keep storage ready for the next request. See which items need
                attention.
              </p>
              <Link
                href="/room"
                className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-[var(--foreground)]"
              >
                <Map size={16} aria-hidden="true" /> Explore Spaces &amp; maps{' '}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="experience-closet-preview">
              <ClosetPreview />
            </div>
          </section>
          <DashboardSnapshotView
            key={snapshot.fetchedAt}
            initialSnapshot={snapshot}
            params={params}
          />
        </div>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
