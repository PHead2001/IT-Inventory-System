import { getLocations } from '@/features/inventory/queries.server';
import { getLabelOrigin } from '@/features/labels/origin.server';
import { getAssetLabel } from '@/features/labels/queries.server';
import { LabelDesigner } from '@/features/labels/label-designer';
import type { LabelRecord } from '@/features/labels/label-sheet';
import { ASSET_UUID, LOCATION_CODE } from '@/features/scan/targets';
export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; location?: string }>;
}) {
  const [locations, params] = await Promise.all([getLocations(), searchParams]);
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
  const initial: LabelRecord[] = [];
  if (params.location && LOCATION_CODE.test(params.location)) {
    const location = locations.find((item) => item.code === params.location);
    if (location)
      initial.push({
        kind: 'location',
        key: location.code,
        name: location.name,
        context: location.breadcrumb,
        path: '/locations/' + location.code,
        state: location.active ? 'active' : 'inactive',
      });
  }
  if (params.asset && ASSET_UUID.test(params.asset)) {
    const asset = await getAssetLabel(params.asset);
    if (asset) initial.push(asset);
  }
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Print labels</h1>
      <p className="mb-6 text-slate-400">
        Select the exact locations and assets to print. Labels open current
        records after sign in.
      </p>
      <LabelDesigner
        locations={locations}
        origin={origin}
        preview={preview}
        initial={initial}
      />
    </>
  );
}
