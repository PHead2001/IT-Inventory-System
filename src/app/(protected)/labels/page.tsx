import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { getLabelOrigin } from '@/features/labels/origin.server';
import { getQueueRecords } from '@/features/labels/queue.server';
import { LabelDesigner } from '@/features/labels/label-designer';
import { getLabelDefaults } from '@/features/configuration/queries.server';
import { requireMember } from '@/lib/auth/session.server';
import {
  ASSET_UUID,
  LOCATION_CODE,
  QUANTITY_UUID,
} from '@/features/scan/targets';
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
    );
  }
  const { origin, preview } = config;
  const selection: { kind: 'location' | 'asset' | 'quantity'; key: string }[] =
    [];
  if (params.location && LOCATION_CODE.test(params.location)) {
    selection.push({ kind: 'location', key: params.location });
  }
  if (params.asset && ASSET_UUID.test(params.asset)) {
    selection.push({ kind: 'asset', key: params.asset.toLowerCase() });
  }
  if (params.quantity && QUANTITY_UUID.test(params.quantity))
    selection.push({ kind: 'quantity', key: params.quantity.toLowerCase() });
  const initial = await getQueueRecords(selection);
  return (
    <>
      <p className="experience-eyebrow print:hidden">Tools / Labels</p>
      <h1 className="experience-heading mb-3 mt-3 print:hidden">
        Print labels
      </h1>
      <p className="experience-muted mb-7 max-w-3xl text-sm leading-6 print:hidden">
        Build a sheet from quantity definitions, assets, and locations. Every
        label opens its current record after sign in.
      </p>
      <LabelDesigner
        locations={locations}
        categories={categories}
        origin={origin}
        memberId={member.user_id}
        preview={preview}
        initial={initial}
        defaults={defaults}
      />
    </>
  );
}
