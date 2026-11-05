import 'server-only';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import type { InventoryResult } from '@/features/inventory/contracts-ui';

const summarySchema = z.array(
  z.object({
    kind: z.enum(['asset', 'quantity']),
    id: z.uuid(),
    thumbnail_path: z.string().nullable(),
    photo_name: z.string().nullable(),
    photo_count: z.number().int().nonnegative(),
    document_count: z.number().int().nonnegative(),
  }),
);
export type FileListSummary = z.infer<typeof summarySchema>[number];

export async function getFileListSummaries(rows: InventoryResult[]) {
  return readSummaries(await requireMember(), rows, undefined, false);
}

/** Reuse the authenticated caller and the handler's cancellation deadline. */
export async function readFileListSummaries(
  context: Awaited<ReturnType<typeof requireMember>>,
  rows: Pick<InventoryResult, 'kind' | 'id'>[],
  signal?: AbortSignal,
) {
  return readSummaries(context, rows, signal, true);
}
async function readSummaries(
  { supabase }: Awaited<ReturnType<typeof requireMember>>,
  rows: Pick<InventoryResult, 'kind' | 'id'>[],
  signal: AbortSignal | undefined,
  rawErrors: boolean,
) {
  if (rows.length === 0) return [];
  const assetIds = [
    ...new Set(rows.filter((row) => row.kind === 'asset').map((row) => row.id)),
  ];
  const quantityIds = [
    ...new Set(
      rows.filter((row) => row.kind === 'quantity').map((row) => row.id),
    ),
  ];
  if (assetIds.length + quantityIds.length > 25)
    throw new Error('Inventory page exceeded the file summary limit.');
  const rpc = supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
  const request = rpc.call(supabase, 'inventory_file_list_thumbnails', {
    p_asset_ids: assetIds,
    p_quantity_ids: quantityIds,
  });
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error) {
    if (rawErrors) throw error;
    throw new Error('Inventory file summaries could not be loaded.');
  }
  return summarySchema.parse(data);
}
