import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';
import { validReturnPath } from '@/features/scan/targets';
export async function requireMember() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    const destination = validReturnPath(
      (await headers()).get('x-inventory-return'),
    );
    redirect(
      destination ? '/login?next=' + encodeURIComponent(destination) : '/login',
    );
  }
  const { data: member, error } = await supabase
    .from('app_members')
    .select('user_id, display_name, role, active, can_manage_configuration')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !isActiveMember(member)) redirect('/access-denied');
  return { supabase, member };
}
