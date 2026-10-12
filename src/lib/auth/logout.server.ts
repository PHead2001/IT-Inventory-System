import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { recordConfirmedLogout } from './privacy-barrier.server';
import {
  logoutFailureMessage,
  logoutUnknownMessage,
  type LogoutResult,
} from './logout-contract';

/** Cookie-scoped sign-out remains available after membership is revoked. */
export async function signOutCurrentSession(): Promise<LogoutResult> {
  try {
    const supabase = await createSupabaseServerClient(true);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return error
      ? { ok: false, message: logoutFailureMessage }
      : { ok: true, ...(await recordConfirmedLogout()) };
  } catch {
    return { ok: false, message: logoutUnknownMessage };
  }
}
