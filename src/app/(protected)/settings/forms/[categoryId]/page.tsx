import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { PrivateDocumentTitle } from '@/components/auth/private-document-title';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import Link from '@/components/experience/route-link';
import { notFound } from 'next/navigation';
import { readCategoryFormPage } from './read.server';
import { recordTitle } from '@/app/(protected)/record-title';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { MetadataSettings } from '@/features/metadata/metadata-settings';
import { designerInstanceKey } from '@/features/metadata/designer-recovery';

export function generateMetadata() {
  return recordTitle('Category forms');
}

export default async function CategoryFormPage({
  params,
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  const configuration = await readCategoryFormPage(categoryId);
  if (!configuration) notFound();
  const { categories, canManage, memberId, category } = configuration;
  return (
    <ProtectedPrivacyContent>
      <RouteReady
        {...await routeReadyProps(
          '/settings/forms/' + encodeURIComponent(categoryId),
          searchParams,
        )}
      >
        <PrivateDocumentTitle
          routePath={`/settings/forms/${encodeURIComponent(categoryId)}`}
          title={
            recordTitle(`${category.name} form`, 'Settings').title.absolute
          }
        />
        <div className="space-y-3">
          <Link href="/settings/forms" className="text-cyan-300 underline">
            All category forms
          </Link>
          <div className={canManage ? 'sr-only' : undefined}>
            <h1 className="text-3xl font-semibold">{category.name} form</h1>
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
              selectedCategoryId={categoryId}
              categories={categories
                .filter((entry) => entry.active && !entry.removed_at)
                .map(({ id, name, active }) => ({ id, name, active }))}
              forms={await getPublishedForms([categoryId])}
              memberId={memberId}
            />
          ) : (
            <p
              role="note"
              className="rounded border border-slate-700 p-4 text-sm text-slate-300"
            >
              Form editing requires an active staff membership with
              configuration access. Ask the application owner if you need that
              access.
            </p>
          )}
        </div>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
