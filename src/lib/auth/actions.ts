'use server';
import { redirect } from 'next/navigation';
import { getAppOrigin } from './origin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';
import { loginDestination } from '@/features/scan/targets';
import { createAuthDiagnostic, observeAuthStage } from './diagnostic.server';
import { readPasswordSession } from './password-session.server';
import {
  confirmationSchema,
  emailSchema,
  loginSchema,
  passwordSchema,
  type AuthState,
} from './schemas';

export async function login(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return { error: 'Enter a valid email and password.' };
  const diagnostic = createAuthDiagnostic();
  return observeAuthStage(diagnostic, 'login.total', async () => {
    const supabase = await observeAuthStage(diagnostic, 'login.client', () =>
      createSupabaseServerClient(true, diagnostic),
    );
    const { data, error } = await observeAuthStage(
      diagnostic,
      'login.credentials',
      () => supabase.auth.signInWithPassword(parsed.data),
    );
    if (error)
      return { error: 'Unable to sign in. Check your email and password.' };
    // Password sign-in returned this user from Auth and persisted its session
    // before resolving. Protected requests still verify their current user.
    const user = data?.user;
    const session = data?.session;
    if (
      !user ||
      typeof user.id !== 'string' ||
      !user.id ||
      !session ||
      typeof session.access_token !== 'string' ||
      !session.access_token ||
      typeof session.refresh_token !== 'string' ||
      !session.refresh_token
    )
      return { error: 'Unable to verify this account. Please try again.' };
    const { data: member, error: memberError } = await observeAuthStage(
      diagnostic,
      'login.membership',
      () =>
        supabase
          .from('app_members')
          .select('user_id, display_name, role, active')
          .eq('user_id', user.id)
          .maybeSingle(),
    );
    if (memberError || !isActiveMember(member)) redirect('/access-denied');
    redirect(loginDestination(form.get('next')));
  });
}
export async function signOutSession(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    const supabase = await createSupabaseServerClient(true);
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return error
      ? { ok: false, message: 'Unable to sign out. Please try again.' }
      : { ok: true };
  } catch {
    return {
      ok: false,
      message:
        'Sign-out could not be confirmed. Retry when your connection is available.',
    };
  }
}
export async function logout() {
  const result = await signOutSession();
  if (!result.ok) throw new Error(result.message);
  redirect('/login');
}
export async function recover(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = emailSchema.safeParse(form.get('email'));
  if (!email.success) return { error: 'Enter a valid email address.' };
  const origin = getAppOrigin();
  const supabase = await createSupabaseServerClient(true);
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: new URL('/auth/confirm', origin).href,
  });
  return {
    message:
      'If this address has an account, a password reset email will arrive shortly.',
  };
}
export async function confirmAuth(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const parsed = confirmationSchema.safeParse({
    token_hash: form.get('token_hash'),
    type: form.get('type'),
  });
  if (!parsed.success)
    return {
      error: 'This link is invalid. Request a new invitation or reset email.',
    };
  const supabase = await createSupabaseServerClient(true);
  const { error } = await supabase.auth.verifyOtp(parsed.data);
  if (error)
    return {
      error:
        'This link has expired or has already been used. Request a new email.',
    };
  redirect('/set-password');
}
export async function setPassword(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const parsed = passwordSchema.safeParse({
    password: form.get('password'),
    confirmation: form.get('confirmation'),
  });
  if (!parsed.success)
    return {
      error: 'Use at least 12 characters and enter the same password twice.',
    };
  const supabase = await createSupabaseServerClient(true);
  const session = await readPasswordSession(supabase.auth);
  if (!session || session.emailProof === 'unusable')
    return {
      error:
        'Unable to verify your session. Sign in again or request a new reset email.',
    };
  const currentPassword = form.get('current_password');
  if (
    !session.emailedCompletion &&
    (typeof currentPassword !== 'string' ||
      !currentPassword.length ||
      currentPassword.length > 128)
  )
    return {
      error: 'Enter your current password, or request a new reset email.',
    };
  const result = await supabase.auth.updateUser({
    password: parsed.data.password,
    ...(!session.emailedCompletion
      ? { current_password: currentPassword as string }
      : {}),
  });
  if (result.error)
    return {
      error:
        'Unable to update the password. Check your current password, use a new password, or request a new reset email.',
    };
  let sessionClosed = false;
  try {
    const signedOut = await supabase.auth.signOut({ scope: 'local' });
    sessionClosed = !signedOut.error;
  } catch {
    // The password has already committed; do not invite a blind mutation retry.
  }
  if (!sessionClosed)
    return {
      error:
        'Your password was updated, but sign-out failed. Sign out before continuing.',
      passwordUpdated: true,
    };
  // Browser privacy cleanup must acknowledge this confirmed logout before leaving.
  // No password or provider/session material crosses this result boundary.
  return { passwordUpdated: true, sessionClosed: true };
}
