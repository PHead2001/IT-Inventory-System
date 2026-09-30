'use server';
import { redirect } from 'next/navigation';
import { getAppOrigin } from './origin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isActiveMember } from './membership';
import { validReturnPath } from '@/features/scan/targets';
import { createAuthDiagnostic, observeAuthStage } from './diagnostic.server';
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
    redirect(validReturnPath(form.get('next')) ?? '/inventory');
  });
}
export async function logout() {
  const supabase = await createSupabaseServerClient(true);
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error('Unable to sign out. Please try again.');
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
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user)
    return { error: 'Your session has expired. Request a new email.' };
  const result = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (result.error)
    return {
      error: 'Unable to update the password. Use a new password and try again.',
    };
  redirect('/inventory');
}
