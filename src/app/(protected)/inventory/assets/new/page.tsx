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
  const initialCategory = categories.find((category) => category.active);
  if (!initialCategory)
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
  const forms = await getPublishedForms([initialCategory.id]);
  return (
    <>
      <p className="experience-eyebrow">Inventory · New record</p>
      <h1 className="experience-heading mt-3">Create serialized asset</h1>
      <p className="experience-muted mb-5 mt-3 max-w-2xl text-sm">
        Record one physical asset at its current location. Tags and serial
        numbers are optional.
      </p>
      <div className={`${panel} max-w-5xl`}>
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
