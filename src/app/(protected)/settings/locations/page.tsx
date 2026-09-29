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
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center text-cyan-300 underline"
      >
        Settings
      </Link>
      <p className="experience-eyebrow mt-3">Configuration / Locations</p>
      <h1 className="experience-heading mb-3">Manage logical locations</h1>
      <p className="mb-5 max-w-3xl text-sm leading-6 text-slate-300">
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
      <ul className="experience-surface mt-5 divide-y divide-slate-700/70 overflow-hidden p-0">
        {locations.map((location) => (
          <li
            key={location.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5"
          >
            <Link
              className="min-w-0 break-words font-medium text-cyan-200 underline decoration-cyan-400/50 underline-offset-2"
              href={`/settings/locations/${encodeURIComponent(location.code)}`}
            >
              {location.name} ({location.code})
            </Link>
            <span className="text-xs font-medium text-slate-300">
              {location.active ? 'Active' : 'Inactive'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
