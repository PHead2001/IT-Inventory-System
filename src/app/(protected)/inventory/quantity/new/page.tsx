import { requireMember } from '@/lib/auth/session.server';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { MutationForm } from '@/features/inventory/components/mutation-form';
import { panel } from '@/features/inventory/components/read-ui';
import Link from 'next/link';
export default async function NewQuantityPage() {
  const { member } = await requireMember();
  if (member.role !== 'staff')
    return (
      <p>Read-only access. Staff membership is required to create inventory.</p>
    );
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  if (!categories.some((category) => category.active))
    return (
      <p role="alert">
        An active category is required before staff can create inventory. Ask a
        configuration maintainer to add one in{' '}
        <Link className="underline" href="/settings">
          Settings
        </Link>
        .
      </p>
    );
  return (
    <>
      <h1 className="mb-5 text-3xl font-semibold">Create quantity inventory</h1>
      <p className="mb-5 text-slate-400">
        Define interchangeable items with zero stock or an initial quantity at
        one location.
      </p>
      <div className={panel}>
        <MutationForm
          operation="quantity_create"
          categories={categories}
          locations={locations}
        />
      </div>
    </>
  );
}
