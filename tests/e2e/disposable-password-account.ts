import type { SupabaseClient } from '@supabase/supabase-js';

/** Own only the account created here, including cleanup after setup/assertion failure. */
export async function withDisposablePasswordAccount(
  client: SupabaseClient,
  credentials: { email: string; password: string },
  signOut: () => Promise<void>,
  run: () => Promise<void>,
) {
  const created = await client.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw new Error('Disposable password account could not be created');
  let operationFailed = false;
  let originalFailure: unknown;
  try {
    const membership = await client.from('app_members').insert({
      user_id: created.data.user.id,
      display_name: 'Password Test',
      role: 'viewer',
      active: true,
    });
    if (membership.error)
      throw new Error('Disposable password membership could not be created');
    await run();
  } catch (error) {
    operationFailed = true;
    originalFailure = error;
  } finally {
    const failed: string[] = [];
    const attempt = async (name: string, cleanup: () => Promise<void>) => {
      try {
        await cleanup();
      } catch {
        failed.push(name);
      }
    };
    await attempt('session sign-out', signOut);
    // app_members references Auth users with RESTRICT: remove membership first.
    await attempt('membership removal', async () => {
      const result = await client
        .from('app_members')
        .delete()
        .eq('user_id', created.data.user.id);
      if (result.error) throw new Error('Membership removal failed');
    });
    await attempt('Auth removal', async () => {
      const result = await client.auth.admin.deleteUser(created.data.user.id);
      if (result.error) throw new Error('Auth removal failed');
    });
    await attempt('membership absence', async () => {
      const result = await client
        .from('app_members')
        .select('user_id')
        .eq('user_id', created.data.user.id)
        .maybeSingle();
      if (result.error || result.data)
        throw new Error('Disposable membership remains');
    });
    await attempt('Auth absence', async () => {
      const result = await client.auth.admin.getUserById(created.data.user.id);
      if (result.data.user || result.error?.status !== 404)
        throw new Error(
          'Disposable Auth account absence could not be verified',
        );
    });
    if (failed.length)
      throw new AggregateError(
        [
          ...(operationFailed ? [originalFailure] : []),
          ...failed.map(
            (name) => new Error('Disposable password cleanup failed: ' + name),
          ),
        ],
        'Disposable password cleanup failed: ' + failed.join(', '),
      );
  }
  if (operationFailed) throw originalFailure;
}
