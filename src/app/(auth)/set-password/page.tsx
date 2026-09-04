import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AuthForm } from '@/components/auth/auth-form';
export const dynamic = 'force-dynamic';
export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect('/forgot-password');
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Set your password</h1>
      <AuthForm mode="password" />
    </>
  );
}
