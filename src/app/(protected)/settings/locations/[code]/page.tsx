import { PrivateDocumentTitle } from '@/components/auth/private-document-title';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import { readManagedLocationPage } from './read.server';
import { recordTitle } from '@/app/(protected)/record-title';
import { LocationManagementForm } from '@/features/custody/management-form';
import { panel } from '@/features/inventory/components/read-ui';

export function generateMetadata() {
  return recordTitle('Rename location');
}

export default async function ManageLocationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { member } = await requireMember();
  const { code } = await params;
  const location = await readManagedLocationPage(code);
  if (!location) notFound();
  return (
    <ProtectedPrivacyContent>
      <PrivateDocumentTitle
        routePath={`/settings/locations/${encodeURIComponent(code)}`}
        title={recordTitle(location.name, 'Location settings').title.absolute}
      />
      <>
        <Link
          className="inline-flex min-h-11 items-center text-cyan-300 underline"
          href={
            '/settings/locations?selected=' + encodeURIComponent(location.code)
          }
        >
          All locations
        </Link>
        <p className="experience-eyebrow mt-3">Configuration / Location</p>
        <h1 className="experience-heading mb-5 break-words">{location.name}</h1>
        {member.role === 'staff' && member.can_manage_configuration ? (
          <LocationManagementForm
            key={`${member.user_id}:${location.id}`}
            location={location}
            actorId={member.user_id}
          />
        ) : (
          <p className={panel}>This location is read-only for your account.</p>
        )}
      </>
    </ProtectedPrivacyContent>
  );
}
