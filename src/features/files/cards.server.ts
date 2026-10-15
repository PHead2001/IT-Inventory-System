import 'server-only';
import { requireMember } from '@/lib/auth/session.server';
import { inventoryFileCardsSchema, type FileParent } from './contract';

export async function getInventoryFileCards(
  parentType: FileParent['parentType'],
  parentId: string,
) {
  const { supabase } = await requireMember();
  const rpc = supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc.call(supabase, 'inventory_file_cards', {
    p_parent_type: parentType,
    p_parent_id: parentId,
  });
  if (error) throw new Error('Inventory files could not be loaded.');
  return inventoryFileCardsSchema.parse(data);
}
