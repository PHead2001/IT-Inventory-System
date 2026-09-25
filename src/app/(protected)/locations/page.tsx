import { getLocations } from '@/features/inventory/queries.server';
import { requireMember } from '@/lib/auth/session.server';
import Link from 'next/link';
import { LocationLink, panel } from '@/features/inventory/components/read-ui';
export default async function LocationsPage() {
  const { member } = await requireMember();
  const locations = await getLocations();
  return (
    <>
      <h1 className="text-3xl font-semibold">Locations</h1>
      <p className="my-4 text-slate-400">
        Browse logical storage locations, including the unmodeled IT Office.
        Storage groups include their child locations.
      </p>
      {member.role === 'staff' && member.can_manage_configuration && (
        <Link
          className="mb-4 inline-flex min-h-11 items-center text-cyan-300 underline"
          href="/settings/locations"
        >
          Manage locations
        </Link>
      )}
      <ul className="space-y-3">
        {locations.map((location) => (
          <li key={location.id} className={panel}>
            <LocationLink location={location} />
            <p className="mt-2 text-xs text-slate-400">
              {!location.active
                ? 'Inactive'
                : location.can_hold_inventory
                  ? 'Inventory destination'
                  : 'Location group'}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
