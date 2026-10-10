import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AuthForm } from '@/components/auth/auth-form';
import { readPasswordSession } from '@/lib/auth/password-session.server';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set password' };
export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const session = await readPasswordSession(supabase.auth);
  const sessionAvailable = !!session && session.emailProof !== 'unusable';
  return (
    <>
      <p className="experience-eyebrow">Account security</p>
      <h1 className="mb-6 mt-2 text-3xl font-semibold tracking-tight">
        Set your password
      </h1>
      {/* Cookie writes re-render this page; preserve the action result owner. */}
      <AuthForm
        mode="password"
        sessionAvailable={sessionAvailable}
        emailedCompletion={sessionAvailable && !!session?.emailedCompletion}
      />
      {sessionAvailable && (
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex min-h-11 items-center text-sm underline"
        >
          Request a new reset email
        </Link>
      )}
    </>
  );
}
