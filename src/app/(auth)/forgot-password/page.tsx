import Link from 'next/link';
import { AuthForm } from '@/components/auth/auth-form';
export const metadata = { title: 'Reset password' };
export default function ForgotPasswordPage() {
  return (
    <>
      <p className="experience-eyebrow">Account recovery</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="mb-7 mt-2 text-sm experience-muted">
        Enter the email address used for your invitation.
      </p>
      <AuthForm mode="recover" />
      <Link
        href="/login"
        className="mt-6 inline-flex min-h-11 items-center text-sm text-cyan-300 underline"
      >
        Back to sign in
      </Link>
    </>
  );
}
