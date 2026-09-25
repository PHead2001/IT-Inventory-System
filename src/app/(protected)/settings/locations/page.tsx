import Link from 'next/link';
import { requireMember } from '@/lib/auth/session.server';
import { getManagedLocations } from '@/features/custody/queries.server';
import { LocationManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageLocationsPage() {
  const { member } = await requireMember();
  const locations = await getManagedLocations();
  const canManage = member.role === 'staff' && member.can_manage_configuration;
  return (
    <>
      <Link href="/settings" className="text-cyan-300 underline">
        Settings
      </Link>
      <h1 className="my-4 text-3xl font-semibold">Manage logical locations</h1>
      <p className="my-4 text-slate-400">
        Add actual storage destinations as they are confirmed. IT Office /
        General Storage / Unsorted is a provisional software location, not a
        measured shelf. Permanent codes and history are retained.
      </p>
      {canManage ? (
        <LocationManagementForm locations={locations} />
      ) : (
        <p className={panel}>
          Location settings are read-only. An active staff configuration
          maintainer can create or edit locations.
        </p>
      )}
      <ul className="mt-6 space-y-2">
        {locations.map((location) => (
          <li key={location.id}>
            <Link
              className="text-cyan-300 underline"
              href={`/settings/locations/${encodeURIComponent(location.code)}`}
            >
              {location.name} ({location.code})
            </Link>{' '}
            · {location.active ? 'Active' : 'Inactive'}
          </li>
        ))}
      </ul>
    </>
  );
}
