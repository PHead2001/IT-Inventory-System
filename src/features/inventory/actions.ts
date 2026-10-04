'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/database.types';
import { isActiveMember } from '@/lib/auth/membership';
import {
  validateCommand,
  mutationError,
  mutationResultSchema,
  type MutationState,
} from './contracts';
import { duplicateSerials } from './queries.server';
import { getQuantityDetail, getLocations } from './queries.server';
import { readMoveReceipt } from './move-receipt.server';
import { z } from 'zod';

const moveReadInput = z.strictObject({
  entityId: z.uuid(),
  eventId: z.uuid().optional(),
  expectedActorId: z.uuid(),
});
async function moveReadClient(expectedActorId: string) {
  const supabase = await createSupabaseServerClient(true);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.id !== expectedActorId)
    throw new Error('Original member required.');
  const membership = await supabase
    .from('app_members')
    .select('user_id,display_name,role,active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (membership.error || !isActiveMember(membership.data))
    throw new Error('Active member required.');
  return supabase;
}
export async function reloadMoveReceipt(input: unknown) {
  const parsed = moveReadInput.extend({ eventId: z.uuid() }).parse(input);
  return readMoveReceipt(
    await moveReadClient(parsed.expectedActorId),
    parsed.entityId,
    parsed.eventId,
  );
}
export async function loadMoveSnapshot(input: unknown) {
  const parsed = moveReadInput.omit({ eventId: true }).parse(input);
  await moveReadClient(parsed.expectedActorId);
  const [detail, locations] = await Promise.all([
    getQuantityDetail(parsed.entityId),
    getLocations(),
  ]);
  if (!detail || detail.item.archived)
    throw new Error('Current stock could not be loaded.');
  return { item: detail.item, balances: detail.balances, locations };
}

export async function submitInventory(input: unknown): Promise<MutationState> {
  const command = validateCommand(input);
  if (!command.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of command.error.issues)
      fieldErrors[issue.path.join('.')] = issue.message;
    return {
      ok: false,
      kind: 'validation',
      code: 'invalid_input',
      message: 'Check the highlighted values.',
      fieldErrors,
    };
  }
  try {
    const supabase = await createSupabaseServerClient(true);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return mutationError('P1001');
    if (
      command.data.expectedActorId &&
      command.data.expectedActorId !== user.id
    )
      return {
        ok: false,
        kind: 'domain',
        code: 'actor_changed',
        message:
          'The signed-in staff member changed. Return to the original account before saving these entries.',
      };
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberError || !isActiveMember(member) || member.role !== 'staff')
      return mutationError('P1001');
    const { data, error } = await supabase.rpc(command.data.operation, {
      p_request_id: command.data.requestId,
      p_payload: command.data.payload as Json,
    });
    if (error) return mutationError(error.code);
    const result = mutationResultSchema.safeParse(data);
    if (!result.success) return mutationError(undefined);
    const committed: Extract<MutationState, { ok: true }> = {
      ok: true,
      entityId: result.data.entity_id,
      version: result.data.version,
      changed: result.data.changed,
      needsMetadata: result.data.needs_metadata,
    };
    // A parsed RPC receipt is commit acknowledgement. Later read/cache failures
    // cannot turn it into an uncertain mutation or invite a second submission.
    if (command.data.operation === 'quantity_move' && result.data.event_id) {
      committed.eventId = result.data.event_id;
      try {
        committed.movement = await readMoveReceipt(
          supabase,
          committed.entityId,
          committed.eventId,
        );
      } catch {
        committed.refreshFailed = true;
      }
    }
    try {
      revalidatePath('/inventory', 'layout');
      revalidatePath('/dashboard');
      revalidatePath('/locations', 'layout');
      revalidatePath('/history');
    } catch {
      committed.refreshFailed = true;
    }
    return committed;
  } catch {
    return mutationError(undefined);
  }
}

export async function findDuplicateSerials(serial: string, excludeId?: string) {
  return duplicateSerials(serial, excludeId);
}
