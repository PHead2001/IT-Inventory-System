import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';
import { validReturnPath } from '@/features/scan/targets';
import { createAuthDiagnostic, observeAuthStage } from './diagnostic.server';
// React cache is scoped to one server render/request. It coalesces nested reads
// without reusing an Auth or membership decision on a later navigation/action.
export const requireMember = cache(async function requireMember() {
  const diagnostic = createAuthDiagnostic();
  return observeAuthStage(diagnostic, 'member.total', async () => {
    const supabase = await observeAuthStage(diagnostic, 'member.client', () =>
      createSupabaseServerClient(false, diagnostic),
    );
    const {
      data: { user },
      error: authError,
    } = await observeAuthStage(diagnostic, 'member.getUser', () =>
      supabase.auth.getUser(),
    );
    if (authError || !user) {
      const destination = validReturnPath(
        (await headers()).get('x-inventory-return'),
      );
      redirect(
        destination
          ? '/login?next=' + encodeURIComponent(destination)
          : '/login',
      );
    }
    const { data: member, error } = await observeAuthStage(
      diagnostic,
      'member.membership',
      () =>
        supabase
          .from('app_members')
          .select(
            'user_id, display_name, role, active, can_manage_configuration',
          )
          .eq('user_id', user.id)
          .maybeSingle(),
    );
    if (error || !isActiveMember(member)) redirect('/access-denied');
    return { supabase, member };
  });
});
