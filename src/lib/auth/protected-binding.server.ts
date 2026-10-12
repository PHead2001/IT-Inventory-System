import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';
import { readLogoutGeneration } from './privacy-barrier.server';
import type { ProtectedPrivacyBinding } from './protected-binding';

/** A readmission check never redirects or replaces the retained action owner. */
export async function verifyProtectedPrivacyBinding(
  expected: ProtectedPrivacyBinding,
  cookieWritable = true,
): Promise<
  | {
      status: 'match';
      generation: Awaited<ReturnType<typeof readLogoutGeneration>>;
    }
  | { status: 'denied' | 'unavailable' }
> {
  try {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
    if (expected.backend !== backend) return { status: 'denied' };
    const supabase = await createSupabaseServerClient(cookieWritable);
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      const status = error.status;
      return {
        status: status === 401 || status === 403 ? 'denied' : 'unavailable',
      };
    }
    if (!data.user || data.user.id !== expected.actorId)
      return { status: 'denied' };
    const { data: member, error: membershipError } = await supabase
      .from('app_members')
      .select('user_id, display_name, role, active, can_manage_configuration')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (membershipError) return { status: 'unavailable' };
    if (
      !isActiveMember(member) ||
      member.user_id !== expected.actorId ||
      member.role !== expected.role ||
      (member.can_manage_configuration === true) !==
        expected.canManageConfiguration
    )
      return { status: 'denied' };
    return { status: 'match', generation: await readLogoutGeneration() };
  } catch {
    return { status: 'unavailable' };
  }
}
