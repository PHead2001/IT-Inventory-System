'use server';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { readFilters } from '@/features/inventory/read-model';
import {
  assetLabelPath,
  locationLabelPath,
  quantityLabelPath,
} from '@/features/scan/targets';
import {
  queueIdentity,
  validQueueKey,
  type LabelKind,
  type LabelSearchFilters,
  type QueueKey,
} from './queue-model';
import type { LabelRecord } from './label-sheet';

const candidate = z.object({
  kind: z.enum(['quantity', 'asset']),
  entity_id: z.uuid(),
  name: z.string(),
  category_name: z.string(),
  status: z.string(),
  asset_tag: z.string().nullable(),
  item_code: z.string().nullable().default(null),
  serial_number: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  holding_context: z.string(),
});
const searchResult = z.object({
  rows: z.array(candidate),
  total: z.number().int().nonnegative(),
});
const liveRow = z.object({
  kind: z.enum(['location', 'quantity', 'asset']),
  key: z.string(),
  name: z.string(),
  context: z.string(),
  state: z.string(),
  tag: z.string().nullable(),
  item_code: z.string().nullable().default(null),
  category_name: z.string().nullable(),
});
const filterInput = z.object({
  q: z.string().max(200),
  type: z.enum(['all', 'quantity', 'asset']),
  status: z.enum(['active', 'historical', 'all']),
  category: z.string().max(100),
  location: z.string().max(100),
  page: z.number().int().min(1).max(100000),
});

export type LabelCandidate = {
  kind: 'quantity' | 'asset';
  key: string;
  name: string;
  categoryName: string;
  status: string;
  assetTag: string | null;
  itemCode: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  holdingContext: string;
};
export type LiveLabel = LabelRecord & {
  tag: string | null;
  categoryName: string | null;
};

export async function searchLabelRecords(input: LabelSearchFilters): Promise<{
  rows: LabelCandidate[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const safe = filterInput.parse(input);
  const filter = readFilters({
    q: safe.q,
    type: safe.type,
    status: safe.status,
    category: safe.category,
    location: safe.location,
    page: String(safe.page),
  });
  const { supabase } = await requireMember();
  const { data, error } = await supabase.rpc('inventory_label_search', {
    p_query: filter.query,
    p_type: filter.type,
    p_status: filter.status,
    p_category_id: filter.category,
    p_location_code: filter.location,
    p_page: filter.page,
    p_page_size: 25,
  });
  if (error || data === null)
    throw new Error('Label search could not be loaded.');
  const result = searchResult.parse(data);
  return {
    rows: result.rows.map((row) => ({
      kind: row.kind,
      key: row.entity_id,
      name: row.name,
      categoryName: row.category_name,
      status: row.status,
      assetTag: row.asset_tag,
      itemCode: row.item_code,
      serialNumber: row.serial_number,
      manufacturer: row.manufacturer,
      model: row.model,
      holdingContext: row.holding_context,
    })),
    total: result.total,
    page: filter.page,
    pageSize: 25,
  };
}

export async function getQueueRecords(
  selection: QueueKey[],
): Promise<LiveLabel[]> {
  if (
    !Array.isArray(selection) ||
    selection.length > 200 ||
    new Set(selection.map(queueIdentity)).size !== selection.length ||
    !selection.every((key) => key && validQueueKey(key))
  )
    throw new Error('Invalid label selection.');
  if (selection.length === 0) return [];
  const { supabase } = await requireMember();
  const { data, error } = await supabase.rpc('inventory_label_resolve', {
    p_selection: selection,
  });
  if (error || data === null)
    throw new Error('Selected labels could not be refreshed.');
  return z
    .array(liveRow)
    .parse(data)
    .map((row) => ({
      kind: row.kind as LabelKind,
      key: row.key,
      name: row.name,
      context: row.context,
      state: row.state,
      tag: row.tag,
      humanId: row.kind === 'quantity' ? row.item_code : null,
      categoryName: row.category_name,
      barcode: row.tag,
      path:
        row.kind === 'location'
          ? locationLabelPath(row.key)
          : row.kind === 'quantity'
            ? quantityLabelPath(row.key)
            : assetLabelPath(row.key),
    }));
}
