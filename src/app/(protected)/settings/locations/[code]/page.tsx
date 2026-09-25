import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { getManagedLocations } from '@/features/custody/queries.server';
import { LocationManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export default async function ManageLocationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { member } = await requireMember();
  const { code } = await params;
  const locations = await getManagedLocations();
  const location = locations.find((row) => row.code === code);
  if (!location) notFound();
  return (
    <>
      <Link className="text-cyan-300 underline" href="/settings/locations">
        All locations
      </Link>
      <h1 className="my-4 text-3xl font-semibold">{location.name}</h1>
      {member.role === 'staff' && member.can_manage_configuration ? (
        <LocationManagementForm
          key={`${location.id}:${location.version}`}
          location={location}
          locations={locations}
        />
      ) : (
        <p className={panel}>This location is read-only for your account.</p>
      )}
    </>
  );
}
