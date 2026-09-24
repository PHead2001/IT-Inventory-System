'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import {
  validateCommand,
  mutationError,
  mutationResultSchema,
  type MutationState,
} from './contracts';
import { duplicateSerials } from './queries.server';

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
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (memberError || !isActiveMember(member) || member.role !== 'staff')
      return mutationError('P1001');
    const { data, error } = await supabase.rpc(command.data.operation as never, {
      p_request_id: command.data.requestId,
      p_payload: command.data.payload,
    } as never);
    if (error) return mutationError(error.code);
    const result = mutationResultSchema.safeParse(data);
    if (!result.success) return mutationError(undefined);
    revalidatePath('/inventory', 'layout');
    revalidatePath('/dashboard');
    revalidatePath('/locations', 'layout');
    revalidatePath('/history');
    return {
      ok: true,
      entityId: result.data.entity_id,
      version: result.data.version,
      changed: result.data.changed,
      needsMetadata: result.data.needs_metadata,
    };
  } catch {
    return mutationError(undefined);
  }
}

export async function findDuplicateSerials(serial: string, excludeId?: string) {
  return duplicateSerials(serial, excludeId);
}
