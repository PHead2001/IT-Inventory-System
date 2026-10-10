import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { getManagedLocations } from '@/features/custody/queries.server';
import { SettingsLocationTree } from '@/features/locations/settings-location-tree';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageLocationsPage() {
  await requireMember();
  const locations = await getManagedLocations();
  return (
    <ProtectedPrivacyContent>
      <>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
        >
          Settings
        </Link>
        <p className="experience-eyebrow mt-3">Configuration / Locations</p>
        <h1 className="experience-heading mb-3">Manage logical locations</h1>
        <p className="mb-5 max-w-3xl text-sm leading-6 text-slate-300">
          IT Office / General Storage / Unsorted is a provisional software
          location, not a measured shelf. Existing locations, permanent codes
          and history are retained.
        </p>
        <p className={panel}>
          Configuration maintainers can rename display labels. Storage
          structure, permanent codes and room bindings are maintained with
          reviewed room code.
        </p>
        <SettingsLocationTree locations={locations} />
      </>
    </ProtectedPrivacyContent>
  );
}
