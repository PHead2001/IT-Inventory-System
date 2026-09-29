import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getConfigurationCategories } from '@/features/configuration/queries.server';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { MetadataSettings } from '@/features/metadata/metadata-settings';
import { designerInstanceKey } from '@/features/metadata/designer-recovery';

export default async function CategoryFormPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  const { categories, canManage, memberId } =
    await getConfigurationCategories();
  const category = categories.find(
    (entry) => entry.id === categoryId && entry.active && !entry.removed_at,
  );
  if (!category) notFound();
  return (
    <div className="space-y-5">
      <Link href="/settings/forms" className="text-cyan-300 underline">
        All category forms
      </Link>
      <div>
        <h1 className="text-3xl font-semibold">{category.name} form</h1>
        <p className="mt-1 text-sm text-slate-400">
          Category form and field configuration
        </p>
      </div>
      {canManage ? (
        <MetadataSettings
          key={
            designerInstanceKey(
              memberId,
              process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            ) +
            ':' +
            categoryId
          }
          categories={[category]}
          forms={await getPublishedForms([categoryId])}
          memberId={memberId}
        />
      ) : (
        <p
          role="note"
          className="rounded border border-slate-700 p-4 text-sm text-slate-300"
        >
          Form editing requires an active staff membership with configuration
          access. Ask the application owner if you need that access.
        </p>
      )}
    </div>
  );
}
