import { getLocations } from '@/features/inventory/queries.server';
import { requireMember } from '@/lib/auth/session.server';
import Link from 'next/link';
import { LocationsBrowserPage } from '@/features/room/locations-browser-page';

export default async function LocationsPage() {
  const { member } = await requireMember();
  const locations = await getLocations();
  return (
    <>
      <p className="experience-eyebrow">Storage / Location hierarchy</p>
      <h1 className="experience-heading mt-1">Locations</h1>
      <p className="my-4 max-w-3xl text-sm leading-6 text-slate-300">
        Browse rooms and their logical storage locations. Selecting a group
        includes its descendants.
      </p>
      {member.role === 'staff' && member.can_manage_configuration && (
        <Link
          className="mb-4 inline-flex min-h-11 items-center text-cyan-300 underline"
          href="/settings/locations"
        >
          Manage locations
        </Link>
      )}
      <LocationsBrowserPage locations={locations} />
    </>
  );
}
