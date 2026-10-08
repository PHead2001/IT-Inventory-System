import Link from 'next/link';
import { AuthForm } from '@/components/auth/auth-form';
import { loginDestination, validReturnPath } from '@/features/scan/targets';
import { redirect } from 'next/navigation';
import { readLoginSession } from '@/lib/auth/login-session.server';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; switch?: string; password?: string }>;
}) {
  const params = await searchParams;
  const next = validReturnPath(params.next);
  const session = await readLoginSession();
  if (params.switch !== '1') {
    if (session === 'member') redirect(loginDestination(params.next));
    if (session === 'denied') redirect('/access-denied');
    if (session === 'unavailable')
      return (
        <>
          <h1 className="text-3xl font-semibold">
            Unable to check your account
          </h1>
          <p role="alert" className="my-5">
            Please try again. Your account access has not changed.
          </p>
          <Link
            href={next ? '/login?next=' + encodeURIComponent(next) : '/login'}
            className="inline-flex min-h-11 items-center underline"
          >
            Try again
          </Link>
          <Link
            href={
              '/login?switch=1' +
              (next ? '&next=' + encodeURIComponent(next) : '')
            }
            className="ml-5 inline-flex min-h-11 items-center underline"
          >
            Use another account
          </Link>
        </>
      );
  }
  return (
    <>
      <p className="experience-eyebrow">Member access</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Welcome back
      </h1>
      <p className="mb-7 mt-2 text-sm text-[#9cafc4]">
        Sign in with your invited IT Inventory account.
      </p>
      {params.password === 'updated' && (
        <p role="status" className="mb-5">
          Sign in with your current password.
        </p>
      )}
      {params.switch === '1' && (
        <p className="mb-5">Sign in to use another account.</p>
      )}
      <AuthForm mode="login" next={next ?? undefined} />
      <Link
        href="/forgot-password"
        className="mt-6 inline-flex min-h-11 items-center text-sm text-cyan-300 underline"
      >
        Forgot password?
      </Link>
      <p className="mt-3 text-xs leading-5 text-[#9cafc4]">
        Access is invitation-only. Contact the application owner if you need an
        account.
      </p>
    </>
  );
}
