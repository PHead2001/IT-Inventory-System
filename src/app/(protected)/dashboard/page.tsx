import { RouteReady } from '@/components/experience/route-ready';
import { MagneticVisual } from '@/components/experience/magnetic-visual';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import Link from '@/components/experience/route-link';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { Map, ArrowRight } from 'lucide-react';
import { ClosetPreview } from '@/components/experience/closet-preview';
import { redirect, unstable_rethrow } from 'next/navigation';
import { loadDashboardSnapshot } from './snapshot.server';
import { DashboardSnapshotView } from './snapshot-view';
import { requireMember } from '@/lib/auth/session.server';
import { mayMutateInventory } from '@/lib/auth/membership';
import { getOverviewSnapshot } from '@/features/overview/queries.server';
import {
  OverviewReadError,
  type OverviewSnapshot,
} from '@/features/overview/contracts';
import { OverviewView } from '@/features/overview/overview-view';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string }>;
}) {
  const params = await searchParams;
  // Keep bookmarked pagination URLs and the detailed stock read/export path.
  if (params.page === undefined && params.view !== 'low-stock') {
    const { member } = await requireMember();
    let snapshot: OverviewSnapshot | null = null;
    let forbidden = false;
    try {
      snapshot = await getOverviewSnapshot('UTC');
    } catch (error) {
      unstable_rethrow(error);
      forbidden = error instanceof OverviewReadError && error.clearSnapshot;
    }
    // Every authoritative server result supersedes all local recovery, including
    // repeated unavailable reads and an account/access change. Never key by a
    // shared failure marker or a possibly repeated timestamp.
    const serverRevision = `${member.user_id}:${crypto.randomUUID()}:${forbidden ? 'forbidden' : 'verified'}`;
    return (
      <ProtectedPrivacyContent>
        <RouteReady {...await routeReadyProps('/dashboard', searchParams)}>
          <OverviewView
            serverRevision={serverRevision}
            initialSnapshot={snapshot}
            initialMayEdit={!forbidden && mayMutateInventory(member)}
            initialForbidden={forbidden}
          />
        </RouteReady>
      </ProtectedPrivacyContent>
    );
  }
  const snapshot = await loadDashboardSnapshot(Number(params.page ?? 1));
  const result = snapshot.result;
  if (result.page > Math.max(1, Math.ceil(result.total / result.pageSize)))
    redirect(
      params.view === 'low-stock'
        ? '/dashboard?view=low-stock&page=1'
        : '/dashboard?page=1',
    );
  return (
    <ProtectedPrivacyContent>
      <RouteReady {...await routeReadyProps('/dashboard', searchParams)}>
        <div className="space-y-5">
          <section className="experience-overview-hero experience-surface-bright">
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
            <div className="experience-closet-preview experience-tilt">
              <MagneticVisual
                kind="tilt"
                className="grid w-full place-items-center"
              >
                <ClosetPreview />
              </MagneticVisual>
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
