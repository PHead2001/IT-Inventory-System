import { requireMember } from '@/lib/auth/session.server';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { MutationForm } from '@/features/inventory/components/mutation-form';
import { panel } from '@/features/inventory/components/read-ui';
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
  return (
    <>
      <h1 className="mb-5 text-3xl font-semibold">Create serialized asset</h1>
      <p className="mb-5 text-slate-400">
        Record one physical asset at its current location. Tags and serial
        numbers are optional.
      </p>
      <div className={panel}>
        <MutationForm
          operation="asset_create"
          categories={categories}
          locations={locations}
        />
      </div>
    </>
  );
}
