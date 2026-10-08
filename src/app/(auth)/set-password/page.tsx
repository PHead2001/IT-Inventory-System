import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AuthForm } from '@/components/auth/auth-form';
import { readPasswordSession } from '@/lib/auth/password-session.server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set password' };
export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const session = await readPasswordSession(supabase.auth);
  if (!session || session.emailProof === 'unusable')
    return (
      <div role="alert">
        <p>Unable to verify your session.</p>
        <nav
          aria-label="Password recovery"
          className="mt-5 flex flex-wrap gap-3"
        >
          <Button asChild variant="outline">
            <Link href="/login?switch=1">Sign in again</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/forgot-password">Request a new reset email</Link>
          </Button>
        </nav>
      </div>
    );
  return (
    <>
      <p className="experience-eyebrow">Account security</p>
      <h1 className="mb-6 mt-2 text-3xl font-semibold tracking-tight">
        Set your password
      </h1>
      <AuthForm mode="password" emailedCompletion={session.emailedCompletion} />
      <Link
        href="/forgot-password"
        className="mt-6 inline-flex min-h-11 items-center text-sm underline"
      >
        Request a new reset email
      </Link>
    </>
  );
}
