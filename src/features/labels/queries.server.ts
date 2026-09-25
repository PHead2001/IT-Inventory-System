'use server';
import { getAssetDetail } from '@/features/inventory/queries.server';
import type { LabelRecord } from './label-sheet';
export async function getAssetLabel(id: string): Promise<LabelRecord | null> {
  const detail = await getAssetDetail(id);
  if (!detail) return null;
  return {
    kind: 'asset',
    key: detail.asset.id,
    name: detail.asset.name,
    context: detail.site
      ? `${detail.site.name} [${detail.site.code}] · assigned site`
      : (detail.location?.breadcrumb ?? 'No current storage or site'),
    path: '/inventory/assets/' + detail.asset.id,
    barcode: detail.asset.assetTag,
    state: detail.asset.status,
  };
}
