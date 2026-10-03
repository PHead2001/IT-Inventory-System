'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/database.types';
import { isActiveMember, mayManageConfiguration } from '@/lib/auth/membership';
import { mutationResultSchema } from '@/features/inventory/contracts';
import {
  custodyError,
  parseCustodyCommand,
  type CustodyState,
} from './contracts';

export async function submitCustody(input: unknown): Promise<CustodyState> {
  const parsed = parseCustodyCommand(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    );
    return {
      ok: false,
      code: 'invalid_input',
      message: 'Check the highlighted values.',
      fieldErrors,
    };
  }
  const { operation, requestId, payload } = parsed.data;
  try {
    const supabase = await createSupabaseServerClient(true);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return custodyError('P1001');
    if (parsed.data.expectedActorId && parsed.data.expectedActorId !== user.id)
      return {
        ok: false,
        code: 'actor_changed',
        message:
          'The signed-in staff member changed. Return to the original account before saving these entries.',
      };
    const { data: member, error: memberError } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active,can_manage_configuration')
      .eq('user_id', user.id)
      .maybeSingle();
    const configOperation =
      operation.startsWith('location_') || operation.startsWith('site_');
    if (
      memberError ||
      !isActiveMember(member) ||
      member.role !== 'staff' ||
      (configOperation && !mayManageConfiguration(member))
    )
      return custodyError('P1001');
    const { data, error } = await supabase.rpc(operation, {
      p_request_id: requestId,
      p_payload: payload as Json,
    });
    if (error?.message === 'use_site_lifecycle')
      return {
        ok: false,
        code: 'P1012',
        message:
          'Use Archive site or Restore site to change site availability and record a reason.',
      };
    if (error) return custodyError(error.code);
    const result = mutationResultSchema.safeParse(data);
    if (!result.success) return custodyError();
    for (const path of [
      '/inventory',
      '/dashboard',
      '/locations',
      '/sites',
      '/history',
      '/settings',
      '/labels',
      '/room',
      '/spaces',
    ])
      revalidatePath(path);
    return {
      ok: true,
      entityId: result.data.entity_id,
      version: result.data.version,
      changed: result.data.changed,
    };
  } catch {
    return custodyError();
  }
}
