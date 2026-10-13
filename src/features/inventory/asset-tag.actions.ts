'use server';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { validIdentifier } from '@/features/scan/targets';

const conflict = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['active', 'retired']),
  asset_tag: z.string().nullable(),
});
export type AssetTagConflict = z.infer<typeof conflict>;

/** Advisory only. The mutation's database uniqueness check remains final. */
export async function checkAssetTag(
  tag: string,
  excludeId?: string,
): Promise<AssetTagConflict | null> {
  const { supabase } = await requireMember();
  if (
    typeof tag !== 'string' ||
    tag.length > 1024 ||
    (excludeId && !z.uuid().safeParse(excludeId).success)
  )
    throw new Error('Asset tag could not be checked.');
  const spelling = tag.trim();
  if (!spelling) return null;
  if (!validIdentifier(spelling))
    throw new Error('Asset tag could not be checked.');
  // Do not case-fold in JavaScript: PostgreSQL owns the normalized unique key.
  const { data, error } = await supabase.rpc('inventory_asset_tag_lookup', {
    p_tag: spelling,
  });
  if (error) throw new Error('Asset tag could not be checked.');
  const row = conflict.nullable().parse(data);
  return row?.id === excludeId ? null : row;
}
