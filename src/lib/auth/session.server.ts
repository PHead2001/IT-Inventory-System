import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';
export async function requireMember() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');
  const { data: member, error } = await supabase
    .from('app_members')
    .select('user_id, display_name, role, active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !isActiveMember(member)) redirect('/access-denied');
  return { supabase, member };
}
