'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import type { Json } from '@/lib/supabase/database.types';
import { formSaveResult, reviewSchema } from './contracts';

type Result =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; message: string };
const messages: Record<string, string> = {
  P1001: 'Only an active configuration maintainer can edit forms.',
  P1002: 'The draft or published revision changed. Refresh and review it.',
  P1017: 'The impact changed. Review it again before publishing.',
  P1028:
    'The form changed while you were editing. Refresh and review the current form before saving.',
  P1030:
    'This form requires the updated application. Refresh before editing it.',
  P1021:
    'The form contains an invalid field, rule, default, option tree, or layout control.',
  P1022: 'The form exceeds the supported field, option, depth, or byte limit.',
  P1016: 'Use a fresh transaction to change a form.',
  '55P03': 'Another inventory change is in progress. Retry shortly.',
  '57014': 'The change exceeded its time budget. Refresh before retrying.',
};
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type ActorCheck =
  { ok: true; userId: string } | { ok: false; code: string; message: string };
const retryIdentity: ActorCheck = {
  ok: false,
  code: 'identity_unverified',
  message: 'Identity could not be confirmed. Retry the access check.',
};
const deniedIdentity: ActorCheck = {
  ok: false,
  code: 'P1001',
  message: messages.P1001,
};
function isKnownAuthDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown; name?: unknown };
  return (
    value.status === 401 ||
    value.status === 403 ||
    value.name === 'AuthSessionMissingError' ||
    ['session_not_found', 'session_missing', 'invalid_jwt'].includes(
      String(value.code ?? ''),
    )
  );
}
async function checkDesignerActor(
  supabase: Client,
  expectedActorId: string,
  payload?: { expectedActorId: unknown },
): Promise<ActorCheck> {
  let auth: Awaited<ReturnType<Client['auth']['getUser']>>;
  try {
    auth = await supabase.auth.getUser();
  } catch (error) {
    return isKnownAuthDenial(error) ? deniedIdentity : retryIdentity;
  }
  if (auth.error)
    return isKnownAuthDenial(auth.error) ? deniedIdentity : retryIdentity;
  const user = auth.data?.user;
  if (
    !user ||
    user.id !== expectedActorId ||
    (payload && payload.expectedActorId !== user.id)
  )
    return deniedIdentity;
  let membership;
  try {
    membership = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active,can_manage_configuration')
      .eq('user_id', user.id)
      .maybeSingle();
  } catch {
    return retryIdentity;
  }
  // A failed membership read is not evidence that membership was revoked.
  if (membership.error) return retryIdentity;
  const member = membership.data;
  if (
    !isActiveMember(member) ||
    member.role !== 'staff' ||
    !member.can_manage_configuration
  )
    return deniedIdentity;
  return { ok: true, userId: user.id };
}
/** Publish a proposed definition atomically. A confirmation request uses a new
 * request ID and the exact original payload plus the server review token. */
export async function saveMetadataForm(input: {
  requestId: string;
  expectedActorId: string;
  payload: Record<string, unknown>;
}): Promise<Result> {
  try {
    const supabase = await createSupabaseServerClient(true);
    const actor = await checkDesignerActor(supabase, input.expectedActorId, {
      expectedActorId: input.payload.expected_actor_id,
    });
    if (!actor.ok) return actor;
    const { data, error } = await supabase.rpc('metadata_form_save', {
      p_request_id: input.requestId,
      p_payload: input.payload as Json,
    });
    if (error)
      return {
        ok: false,
        code: error.code,
        message:
          messages[error.code] ??
          'The form could not be saved. Retry the same submission.',
      };
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return {
        ok: false,
        code: 'unexpected',
        message: 'The form could not be saved. Retry the same submission.',
      };
    const checked = formSaveResult.safeParse(data);
    if (!checked.success)
      return {
        ok: false,
        code: 'unexpected',
        message: 'The form save returned an unsupported result.',
      };
    const result = checked.data;
    if (result.status === 'saved') {
      revalidatePath('/settings');
      revalidatePath('/inventory', 'layout');
    }
    return { ok: true, data: result };
  } catch {
    return {
      ok: false,
      code: 'unexpected',
      message: 'The form could not be saved. Retry the same submission.',
    };
  }
}
export async function submitMetadataDraft(input: {
  operation:
    'metadata_draft_save' | 'metadata_draft_discard' | 'metadata_publish';
  requestId: string;
  expectedActorId: string;
  payload: Record<string, unknown>;
}): Promise<Result> {
  try {
    const supabase = await createSupabaseServerClient(true);
    const actor = await checkDesignerActor(supabase, input.expectedActorId, {
      expectedActorId: input.payload.expected_actor_id,
    });
    if (!actor.ok) return actor;
    const { data, error } = await supabase.rpc(input.operation, {
      p_request_id: input.requestId,
      p_payload: input.payload as Json,
    });
    if (error)
      return {
        ok: false,
        code: error.code,
        message:
          messages[error.code] ??
          'The change could not be confirmed. Retry the same submission.',
      };
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return {
        ok: false,
        code: 'unexpected',
        message:
          'The change could not be confirmed. Retry the same submission.',
      };
    revalidatePath('/settings');
    revalidatePath('/inventory', 'layout');
    return { ok: true, data: data as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      code: 'unexpected',
      message: 'The change could not be confirmed. Retry the same submission.',
    };
  }
}

export async function reviewMetadataPublish(input: {
  categoryId: string;
  expectedActorId: string;
  expectedDraftId: string;
  expectedDraftVersion: string;
  expectedPublishedRevisionId: string;
}) {
  try {
    const supabase = await createSupabaseServerClient(true);
    const actor = await checkDesignerActor(supabase, input.expectedActorId);
    if (!actor.ok) return actor;
    const { data, error } = await supabase.rpc('metadata_publish_review', {
      p_payload: {
        category_id: input.categoryId,
        expected_actor_id: input.expectedActorId,
        expected_draft_id: input.expectedDraftId,
        expected_draft_version: input.expectedDraftVersion,
        expected_published_revision_id: input.expectedPublishedRevisionId,
      },
    });
    if (error)
      return {
        ok: false as const,
        code: error.code,
        message: messages[error.code] ?? 'Impact could not be reviewed.',
      };
    return { ok: true as const, review: reviewSchema.parse(data) };
  } catch {
    return {
      ok: false as const,
      code: 'unexpected',
      message: 'Impact could not be reviewed.',
    };
  }
}

export async function verifyMetadataDesignerIdentity(
  expectedActorId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const supabase = await createSupabaseServerClient(true);
    const actor = await checkDesignerActor(supabase, expectedActorId);
    if (!actor.ok) return actor;
    return { ok: true };
  } catch {
    return {
      ok: false,
      code: 'unexpected',
      message: 'Identity could not be confirmed. Refresh before editing.',
    };
  }
}
