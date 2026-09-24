import Link from 'next/link';
import { AuthForm } from '@/components/auth/auth-form';
import { validReturnPath } from '@/features/scan/targets';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = validReturnPath((await searchParams).next);
  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mb-7 mt-2 text-sm text-slate-400">
        Sign in with your invited IT Inventory account.
      </p>
      <AuthForm mode="login" next={next ?? undefined} />
      <Link
        href="/forgot-password"
        className="mt-6 inline-flex min-h-11 items-center text-sm text-cyan-300 underline"
      >
        Forgot password?
      </Link>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Access is invitation-only. Contact the application owner if you need an
        account.
      </p>
    </>
  );
}
