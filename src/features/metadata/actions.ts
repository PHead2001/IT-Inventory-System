'use server';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from '@/lib/auth/membership';
import { reviewSchema } from './contracts';

type Result =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; message: string };
const messages: Record<string, string> = {
  P1001: 'Only an active configuration maintainer can edit forms.',
  P1002: 'The draft or published revision changed. Refresh and review it.',
  P1017: 'The impact changed. Review it again before publishing.',
  P1021:
    'The form contains an invalid field, rule, default, option tree, or layout control.',
  P1022: 'The form exceeds the supported field, option, depth, or byte limit.',
  P1016: 'Use a fresh transaction to change a form.',
  '55P03': 'Another inventory change is in progress. Retry shortly.',
  '57014': 'The change exceeded its time budget. Refresh before retrying.',
};
export async function submitMetadataDraft(input: {
  operation:
    'metadata_draft_save' | 'metadata_draft_discard' | 'metadata_publish';
  requestId: string;
  payload: Record<string, unknown>;
}): Promise<Result> {
  try {
    const supabase = await createSupabaseServerClient(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, code: 'P1001', message: messages.P1001 };
    const { data: member } = await supabase
      .from('app_members')
      .select('user_id,display_name,role,active,can_manage_configuration')
      .eq('user_id', user.id)
      .maybeSingle();
    if (
      !isActiveMember(member) ||
      member.role !== 'staff' ||
      !member.can_manage_configuration
    )
      return { ok: false, code: 'P1001', message: messages.P1001 };
    const { data, error } = await supabase.rpc(
      input.operation as never,
      {
        p_request_id: input.requestId,
        p_payload: input.payload,
      } as never,
    );
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

export async function reviewMetadataPublish(categoryId: string) {
  try {
    const supabase = await createSupabaseServerClient(true);
    const { data, error } = await supabase.rpc(
      'metadata_publish_review' as never,
      {
        p_category_id: categoryId,
      } as never,
    );
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
