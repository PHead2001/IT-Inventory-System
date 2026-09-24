import { requireMember } from '@/lib/auth/session.server';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { panel } from '@/features/inventory/components/read-ui';
import Link from 'next/link';
export default async function NewAssetPage() {
  const { member } = await requireMember();
  if (member.role !== 'staff')
    return (
      <p>Read-only access. Staff membership is required to create assets.</p>
    );
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  const forms = await getPublishedForms(
    categories.map((category) => category.id),
  );
  if (!categories.some((category) => category.active))
    return (
      <p role="alert">
        An active category is required before staff can create assets. Ask a
        configuration maintainer to add one in{' '}
        <Link className="underline" href="/settings">
          Settings
        </Link>
        .
      </p>
    );
  return (
    <>
      <h1 className="mb-5 text-3xl font-semibold">Create serialized asset</h1>
      <p className="mb-5 text-slate-400">
        Record one physical asset at its current location. Tags and serial
        numbers are optional.
      </p>
      <div className={panel}>
        <MetadataForm
          kind="asset"
          categories={categories}
          locations={locations}
          forms={forms}
        />
      </div>
    </>
  );
}
