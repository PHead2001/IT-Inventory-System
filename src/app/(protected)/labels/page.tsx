import { RouteReady } from '@/components/experience/route-ready';
import { routeReadyProps } from '@/components/experience/route-ready.server';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { getLabelOrigin } from '@/features/labels/origin.server';
import { LabelDesigner } from '@/features/labels/label-designer';
import { getLabelDefaults } from '@/features/configuration/queries.server';
import { requireMember } from '@/lib/auth/session.server';
import { labelIntentKeys } from '@/features/labels/add-intent';
export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    asset?: string;
    quantity?: string;
    location?: string;
  }>;
}) {
  const [{ member }, locations, categories, params, defaults] =
    await Promise.all([
      requireMember(),
      getLocations(),
      getCategories(),
      searchParams,
      getLabelDefaults(),
    ]);
  let config: ReturnType<typeof getLabelOrigin>;
  try {
    config = getLabelOrigin();
  } catch {
    return (
      <ProtectedPrivacyContent>
        <RouteReady {...await routeReadyProps('/labels', searchParams)}>
          <>
            <p className="experience-eyebrow">Tools / Labels</p>
            <h1 className="experience-heading mb-3 mt-3">Print labels</h1>
            <p
              role="alert"
              className="experience-feedback max-w-3xl text-amber-200"
            >
              Label generation needs a configured stable application origin. Set
              APP_ORIGIN to the HTTPS production origin, or configure the stable
              branch preview origin, then reload this page.
            </p>
          </>
        </RouteReady>
      </ProtectedPrivacyContent>
    );
  }
  const { origin, preview } = config;
  const addIntent = labelIntentKeys(params);
  return (
    <ProtectedPrivacyContent>
      <RouteReady {...await routeReadyProps('/labels', searchParams)}>
        <>
          <p className="experience-eyebrow print:hidden">Tools / Labels</p>
          <h1 className="experience-heading mb-3 mt-3 print:hidden">
            Print labels
          </h1>
          <p className="experience-muted mb-7 max-w-3xl text-sm leading-6 print:hidden">
            Build a sheet from quantity items, individual assets, and locations.
            Every label opens its current record after sign in.
          </p>
          <LabelDesigner
            locations={locations}
            categories={categories}
            origin={origin}
            memberId={member.user_id}
            preview={preview}
            addIntent={addIntent}
            defaults={defaults}
          />
        </>
      </RouteReady>
    </ProtectedPrivacyContent>
  );
}
