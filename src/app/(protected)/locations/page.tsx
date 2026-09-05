import { getLocations } from '@/features/inventory/queries.server';
import { LocationLink, panel } from '@/features/inventory/components/read-ui';
export default async function LocationsPage() {
  const locations = await getLocations();
  return (
    <>
      <h1 className="text-3xl font-semibold">Locations</h1>
      <p className="my-4 text-slate-400">
        Browse the IT Closet hierarchy. Storage groups include their child
        locations.
      </p>
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
