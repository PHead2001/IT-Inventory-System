'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseConfig } from '@/lib/supabase/config';
import { mayManageConfiguration } from '@/lib/auth/membership';
import {
  configurationError,
  parseConfigurationCommand,
  parseConfigurationResult,
  removalReviewSchema,
  type ConfigurationState,
  type RemovalReview,
} from './contracts';

class ConfigurationBindingError extends Error {
  constructor(readonly code: 'actor_changed' | 'backend_changed') {
    super('Configuration caller binding changed');
  }
}
async function maintainerClient(binding?: {
  expectedActorId?: string;
  expectedBackend?: string;
}) {
  if (
    binding?.expectedBackend &&
    new URL(supabaseConfig().url).origin !== binding.expectedBackend
  )
    throw new ConfigurationBindingError('backend_changed');
  const supabase = await createSupabaseServerClient(true);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  if (binding?.expectedActorId && binding.expectedActorId !== user.id)
    throw new ConfigurationBindingError('actor_changed');
  const { data: member, error: memberError } = await supabase
    .from('app_members')
    .select('user_id,display_name,role,active,can_manage_configuration')
    .eq('user_id', user.id)
    .maybeSingle();
  return !memberError && mayManageConfiguration(member) ? supabase : null;
}

export async function submitConfiguration(
  input: unknown,
): Promise<ConfigurationState> {
  const command = parseConfigurationCommand(input);
  if (!command) return configurationError('P1012');
  try {
    const supabase = await maintainerClient(command);
    if (!supabase) return configurationError('P1001');
    const { data, error } = await supabase.rpc(command.operation, {
      p_request_id: command.requestId,
      p_payload: command.payload,
    });
    if (error) return configurationError(error.code);
    const result = parseConfigurationResult(data);
    if (!result.success) return configurationError(undefined);
    revalidatePath('/settings');
    revalidatePath('/inventory', 'layout');
    revalidatePath('/history');
    revalidatePath('/dashboard');
    revalidatePath('/labels');
    return { ok: true, result: result.data };
  } catch (error) {
    if (error instanceof ConfigurationBindingError)
      return configurationError(error.code);
    return configurationError(undefined);
  }
}

export async function reviewCategoryRemoval(
  sourceId: string,
  targetId: string | null,
): Promise<{ ok: true; review: RemovalReview } | ConfigurationState> {
  if (
    !/^[0-9a-f-]{36}$/i.test(sourceId) ||
    (targetId && !/^[0-9a-f-]{36}$/i.test(targetId))
  )
    return configurationError('P1012');
  try {
    const supabase = await maintainerClient();
    if (!supabase) return configurationError('P1001');
    const { data, error } = await supabase.rpc('category_removal_review', {
      p_category_id: sourceId,
      p_replacement_id: targetId ?? undefined,
    });
    if (error) return configurationError(error.code);
    const parsed = removalReviewSchema.safeParse(data);
    return parsed.success
      ? { ok: true, review: parsed.data }
      : configurationError(undefined);
  } catch {
    return configurationError(undefined);
  }
}
