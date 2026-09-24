import {
  getCategories,
  getLocations,
} from '@/features/inventory/queries.server';
import { getLabelOrigin } from '@/features/labels/origin.server';
import { getQueueRecords } from '@/features/labels/queue.server';
import { LabelDesigner } from '@/features/labels/label-designer';
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
  const [{ member }, locations, categories, params] = await Promise.all([
    requireMember(),
    getLocations(),
    getCategories(),
    searchParams,
  ]);
  let config: ReturnType<typeof getLabelOrigin>;
  try {
    config = getLabelOrigin();
  } catch {
    return (
      <>
        <h1 className="mb-2 text-3xl font-semibold">Print labels</h1>
        <p
          role="alert"
          className="rounded border border-amber-600 p-4 text-amber-200"
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
      <h1 className="mb-2 text-3xl font-semibold">Print labels</h1>
      <p className="mb-6 text-slate-400">
        Select exact quantity definitions, assets, and locations to print.
        Labels open current records after sign in.
      </p>
      <LabelDesigner
        locations={locations}
        categories={categories}
        origin={origin}
        memberId={member.user_id}
        preview={preview}
        initial={initial}
      />
    </>
  );
}
