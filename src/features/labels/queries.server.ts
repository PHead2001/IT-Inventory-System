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
    categoryName: detail.asset.categoryName,
    manufacturer: detail.asset.manufacturer,
    model: detail.asset.model,
    serialNumber: detail.asset.serialNumber,
    path: '/inventory/assets/' + detail.asset.id,
    barcode: detail.asset.assetTag,
  };
}
