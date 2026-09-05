import Link from 'next/link';
import { AuthForm } from '@/components/auth/auth-form';
import { confirmationSchema } from '@/lib/auth/schemas';
export const dynamic = 'force-dynamic';
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = confirmationSchema.safeParse({
    token_hash: params.token_hash,
    type: params.type,
  });
  return (
    <main className="mx-auto max-w-md p-6 pt-20">
      <h1 className="text-2xl font-semibold">Confirm your email link</h1>
      {parsed.success ? (
        <>
          <p className="my-6 text-slate-400">
            Continue to accept your invitation or reset your password.
          </p>
          <AuthForm
            mode="confirm"
            tokenHash={parsed.data.token_hash}
            tokenType={parsed.data.type}
          />
        </>
      ) : (
        <>
          <p role="alert" className="my-6 text-red-300">
            This link is invalid. Request a new invitation or reset email.
          </p>
          <Link href="/forgot-password" className="text-cyan-300 underline">
            Request a new reset email
          </Link>
        </>
      )}
    </main>
  );
}
