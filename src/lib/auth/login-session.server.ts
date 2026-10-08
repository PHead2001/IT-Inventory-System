import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';

export async function readLoginSession(): Promise<
  'anonymous' | 'member' | 'denied' | 'unavailable'
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Missing/invalid credentials permit a new sign-in. Network or provider
      // failures do not establish that the current account is signed out.
      return error.name === 'AuthSessionMissingError' ||
        [400, 401, 403].includes(error.status ?? 0)
        ? 'anonymous'
        : 'unavailable';
    }
    if (!data.user) return 'anonymous';
    const membership = await supabase
      .from('app_members')
      .select('user_id, display_name, role, active')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (membership.error) return 'unavailable';
    return isActiveMember(membership.data) ? 'member' : 'denied';
  } catch {
    return 'unavailable';
  }
}
