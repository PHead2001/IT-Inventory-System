import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl } from './runtime.mjs';
import authFixture from '../tests/fixtures/auth.json' with { type: 'json' };
export const fixturePassword = authFixture.password;
export const fixtureEmails = authFixture.emails;
export async function seedUsers(status) {
  assertLocalUrl(status.API_URL, 54321);
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  for (const [kind, email] of Object.entries(fixtureEmails)) {
    let user = listed.data.users.find((u) => u.email === email);
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email,
        password: fixturePassword,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      user = created.data.user;
    } else {
      const updated = await admin.auth.admin.updateUserById(user.id, {
        password: fixturePassword,
      });
      if (updated.error) throw updated.error;
    }
    // Prove real password Auth before browser assertions obscure fixture failures.
    const reader = createClient(status.API_URL, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await reader.auth.signInWithPassword({
      email,
      password: fixturePassword,
    });
    if (signedIn.error)
      throw new Error(
        'Local ' +
          kind +
          ' fixture cannot sign in: ' +
          signedIn.error.code +
          ' (HTTP ' +
          signedIn.error.status +
          ')',
      );
    const signedOut = await reader.auth.signOut({ scope: 'local' });
    if (signedOut.error) throw new Error('Local fixture sign-out failed');
    if (kind !== 'nonmember') {
      const result = await admin.from('app_members').upsert({
        user_id: user.id,
        display_name: 'Test ' + kind,
        role: kind === 'viewer' ? 'viewer' : 'staff',
        active: kind !== 'inactive',
      });
      if (result.error) throw result.error;
    }
  }
  return admin;
}
