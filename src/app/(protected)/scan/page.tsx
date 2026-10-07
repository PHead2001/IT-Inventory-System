import { ScanPanel } from '@/features/scan/scan-panel';
import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { getSites } from '@/features/custody/queries.server';
import { getLocations } from '@/features/inventory/queries.server';
import { AssignmentWorkspace } from '@/features/scan/assign-workspace';
import { ASSET_UUID } from '@/features/scan/targets';

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; site?: string }>;
}) {
  const { member } = await requireMember();
  const filters = await searchParams;
  const assigning = filters.mode === 'assign';
  const allowed = member.role === 'staff';
  const [sites, locations] =
    assigning && allowed
      ? await Promise.all([getSites(), getLocations()])
      : [[], []];
  const selected =
    typeof filters.site === 'string' && ASSET_UUID.test(filters.site)
      ? sites.find((site) => site.id === filters.site && site.active)
      : null;
  return (
    <>
      <p className="experience-eyebrow">Find / Labels</p>
      <h1 className="experience-heading mt-3">
        {assigning ? 'Scan and assign' : 'Scan and open'}
      </h1>
      <nav
        aria-label="Scan mode"
        className="my-3 flex flex-wrap gap-4 text-cyan-300 underline"
      >
        <Link
          className="inline-flex min-h-11 items-center"
          href="/scan"
          aria-current={!assigning ? 'page' : undefined}
        >
          Scan to open
        </Link>
        {allowed && (
          <Link
            className="inline-flex min-h-11 items-center"
            href="/scan?mode=assign"
            aria-current={assigning ? 'page' : undefined}
          >
            Assign equipment
          </Link>
        )}
      </nav>
      {assigning ? (
        allowed ? (
          <AssignmentWorkspace
            actorId={member.user_id}
            backend={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}
            sites={sites}
            locations={locations}
            initialSiteId={selected?.id}
            siteIssue={
              filters.site && !selected
                ? 'The requested destination is unavailable or archived. Choose an active site before inspecting equipment.'
                : undefined
            }
          />
        ) : (
          <p className="experience-feedback">
            Assignment requires an active staff account. You can still use Scan
            to open to inspect inventory.
          </p>
        )
      ) : (
        <>
          <p className="experience-muted mb-7 mt-3 max-w-2xl text-sm leading-6">
            Scan an inventory label or enter a code to open a location, asset,
            or quantity item. Looking up a code does not change inventory.
          </p>
          <ScanPanel />
        </>
      )}
    </>
  );
}
