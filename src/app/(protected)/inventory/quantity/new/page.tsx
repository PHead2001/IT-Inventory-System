import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { requireMember } from '@/lib/auth/session.server';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { MetadataForm } from '@/features/metadata/metadata-form';
import { getPublishedForms } from '@/features/metadata/queries.server';
import { panel } from '@/features/inventory/components/read-ui';
import Link from '@/components/experience/route-link';
export default async function NewQuantityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const query = await searchParams;
  const returnTo = query?.returnTo;
  const draft = typeof query?.draft === 'string' ? query.draft : undefined;
  const instance = draft ?? crypto.randomUUID();
  const { member } = await requireMember();
  if (member.role !== 'staff')
    return (
      <RouteReady
        {...await routeReadyProps('/inventory/quantity/new', searchParams)}
      >
        <p>
          Read-only access. Staff membership is required to create inventory.
        </p>
      </RouteReady>
    );
  const [categories, locations] = await Promise.all([
    getCategories(),
    getLocations(),
  ]);
  const initialCategory = categories.find((category) => category.active);
  if (!initialCategory)
    return (
      <RouteReady
        {...await routeReadyProps('/inventory/quantity/new', searchParams)}
      >
        <p role="alert">
          An active category is required before staff can create inventory. Ask
          a configuration maintainer to add one in{' '}
          <Link className="underline" href="/settings">
            Settings
          </Link>
          .
        </p>
      </RouteReady>
    );
  const forms = await getPublishedForms([initialCategory.id]);
  return (
    <RouteReady
      {...await routeReadyProps('/inventory/quantity/new', searchParams)}
    >
      <>
        <p className="experience-eyebrow">Inventory · New record</p>
        <h1 className="experience-heading mt-3">Add quantity item</h1>
        <p className="experience-muted mb-5 mt-3 max-w-2xl text-sm">
          Track interchangeable items by count, such as cables and adapters.
        </p>
        <div className={`${panel} max-w-5xl`}>
          <MetadataForm
            key={`${member.user_id}:quantity:${instance}`}
            creationInstanceId={instance}
            creationDraftId={draft}
            recoveryBackend={process.env.NEXT_PUBLIC_SUPABASE_URL}
            actorId={member.user_id}
            kind="quantity"
            categories={categories}
            locations={locations}
            forms={forms}
            returnTo={typeof returnTo === 'string' ? returnTo : undefined}
          />
        </div>
      </>
    </RouteReady>
  );
}
