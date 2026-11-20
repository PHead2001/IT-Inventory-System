import { notFound } from 'next/navigation';
import { recordTitle } from '@/app/(protected)/record-title';
import { PrivateDocumentTitle } from '@/components/auth/private-document-title';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { panel } from '@/features/inventory/components/read-ui';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { requireMember } from '@/lib/auth/session.server';
import { readQuantityPage } from '../read.server';

export function generateMetadata() {
  return recordTitle('Set reorder threshold');
}

export default async function QuantityThresholdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { member } = await requireMember();
  const { id } = await params;
  const pathname = `/inventory/quantity/${encodeURIComponent(id)}/threshold`;

  if (member.role !== 'staff') {
    const readiness = await routeReadyProps(pathname, searchParams);
    return (
      <ProtectedPrivacyContent routeKey={readiness.routeKey}>
        <RouteReady {...readiness}>
          <p>Staff membership is required to set reorder thresholds.</p>
        </RouteReady>
      </ProtectedPrivacyContent>
    );
  }

  const detail = await readQuantityPage(id);
  if (!detail || detail.item.archived) notFound();
  const { item } = detail;
  const [categories, locations, forms, readiness] = await Promise.all([
    getCategories(),
    getLocations(),
    getPublishedForms([item.categoryId]),
    routeReadyProps(pathname, searchParams),
  ]);

  return (
    <ProtectedPrivacyContent routeKey={readiness.routeKey}>
      <RouteReady {...readiness}>
        <PrivateDocumentTitle
          routePath={pathname}
          title={recordTitle(item.name, 'Set reorder threshold').title.absolute}
        />
        <h1 className="experience-heading mb-5">
          Set reorder threshold for {item.name}
        </h1>
        <div className={`${panel} max-w-5xl`}>
          <MetadataForm
            key={`${member.user_id}:quantity:${item.id}`}
            kind="quantity"
            item={item}
            categories={categories}
            locations={locations}
            forms={forms}
            actorId={member.user_id}
            recoveryBackend={process.env.NEXT_PUBLIC_SUPABASE_URL}
            thresholdSetup
          />
        </div>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
