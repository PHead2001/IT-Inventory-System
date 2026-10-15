import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { requireMember } from '@/lib/auth/session.server';
import {
  inventoryFileCardsSchema,
  type FileParent,
  type InventoryFileCardsState,
} from './contract';

function isReadDenial(error: unknown, status?: number) {
  const details = error && typeof error === 'object' ? error : {};
  const httpStatus =
    ('status' in details ? details.status : undefined) ?? status;
  const code = 'code' in details ? details.code : undefined;
  return (
    httpStatus === 401 ||
    httpStatus === 403 ||
    ('name' in details && details.name === 'AuthSessionMissingError') ||
    [
      'P1001',
      '42501',
      'PGRST301',
      'PGRST302',
      'PGRST303',
      'session_not_found',
      'session_missing',
      'invalid_jwt',
    ].includes(String(code))
  );
}

export async function getInventoryFileCards(
  parentType: FileParent['parentType'],
  parentId: string,
): Promise<InventoryFileCardsState> {
  // Membership and its redirect/control flow are never optional file metadata.
  const { supabase } = await requireMember();
  const rpc = supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown; status?: number }>;
  let result: Awaited<ReturnType<typeof rpc>>;
  try {
    result = await rpc.call(supabase, 'inventory_file_cards', {
      p_parent_type: parentType,
      p_parent_id: parentId,
    });
  } catch (error) {
    unstable_rethrow(error);
    if (isReadDenial(error)) throw error;
    return { status: 'unavailable' };
  }
  if (result.error) {
    unstable_rethrow(result.error);
    if (isReadDenial(result.error, result.status)) throw result.error;
    return { status: 'unavailable' };
  }
  const parsed = inventoryFileCardsSchema.safeParse(result.data);
  return parsed.success
    ? { status: 'ready', envelope: parsed.data }
    : { status: 'unavailable' };
}
