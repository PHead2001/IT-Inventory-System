import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const apiUrl = new URL(process.env.LOCAL_API_URL!);
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(apiUrl.hostname),
  'Refusing nonlocal Auth test target',
);
assert.equal(apiUrl.port, '54321', 'Refusing unexpected Auth test port');
assert.equal(apiUrl.pathname, '/', 'Refusing unexpected Auth test path');
const url = apiUrl.origin;
const anon = process.env.LOCAL_ANON_KEY!;
const client = (key = anon) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = client(process.env.LOCAL_SERVICE_ROLE_KEY!);
const ids: string[] = [];
const password = 'Disposable-' + randomUUID();
const nextPassword = 'Replacement-' + randomUUID();
const email = 'policy-' + randomUUID() + '@example.test';
const directUpdate = (token: string, body: Record<string, string>) =>
  fetch(url + '/auth/v1/user', {
    method: 'PUT',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
try {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ok(
    !created.error && created.data.user,
    'Disposable Auth account creation failed',
  );
  ids.push(created.data.user.id);
  const ordinary = client();
  const signedIn = await ordinary.auth.signInWithPassword({ email, password });
  assert.ok(
    !signedIn.error && signedIn.data.session,
    'Disposable ordinary password sign-in failed',
  );
  const token = signedIn.data.session.access_token;
  const missing = await directUpdate(token, { password: nextPassword });
  assert.equal(
    missing.ok,
    false,
    'Direct ordinary update must reject missing current password',
  );
  const wrong = await directUpdate(token, {
    password: nextPassword,
    current_password: 'Incorrect-' + randomUUID(),
  });
  assert.equal(
    wrong.ok,
    false,
    'Direct ordinary update must reject wrong current password',
  );
  assert.ok(
    !(await client().auth.signInWithPassword({ email, password })).error,
    'Rejected direct changes must preserve the original password',
  );
  const accepted = await directUpdate(token, {
    password: nextPassword,
    current_password: password,
  });
  assert.ok(
    accepted.ok,
    'Direct ordinary update with correct current password failed',
  );
  assert.ok(
    !(await client().auth.signInWithPassword({ email, password: nextPassword }))
      .error,
    'Confirmed direct change did not update password',
  );

  const recovery = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  });
  assert.ok(!recovery.error, 'Disposable recovery link creation failed');
  const recoverClient = client();
  const exchanged = await recoverClient.auth.verifyOtp({
    type: 'recovery',
    token_hash: recovery.data.properties.hashed_token,
  });
  assert.ok(
    !exchanged.error && exchanged.data.session,
    'Disposable recovery exchange failed',
  );
  const recoveryToken = exchanged.data.session.access_token;
  const verified = await recoverClient.auth.getClaims();
  assert.ok(
    !verified.error &&
      verified.data?.claims.amr?.some(
        (entry) =>
          typeof entry === 'object' &&
          ['otp', 'magiclink', 'recovery'].includes(entry.method),
      ),
    'Recovery must provide verified emailed AMR',
  );
  const recovered = await directUpdate(recoveryToken, { password });
  assert.ok(
    recovered.ok,
    'Direct recent recovery must permit forgotten-password completion',
  );
  const replay = await client().auth.verifyOtp({
    type: 'recovery',
    token_hash: recovery.data.properties.hashed_token,
  });
  assert.ok(
    replay.error && !replay.data.session,
    'Consumed recovery email must not exchange again',
  );
  // Observe provider-session reuse independently from the one-use email token.
  const reused = await directUpdate(recoveryToken, { password: nextPassword });
  console.log(
    'Local GoTrue password policy: ordinary missing/wrong rejected; correct current accepted; recovery accepted; email replay rejected; existing recovery JWT reuse ' +
      (reused.ok ? 'accepted' : 'rejected') +
      '.',
  );

  const invite = await admin.auth.admin.generateLink({
    type: 'invite',
    email: 'policy-invite-' + randomUUID() + '@example.test',
  });
  assert.ok(
    !invite.error && invite.data.user,
    'Disposable invitation creation failed',
  );
  ids.push(invite.data.user.id);
  const invited = client();
  const invitation = await invited.auth.verifyOtp({
    type: 'invite',
    token_hash: invite.data.properties.hashed_token,
  });
  assert.ok(
    !invitation.error && invitation.data.session,
    'Disposable invitation exchange failed',
  );
  assert.ok(
    (await directUpdate(invitation.data.session.access_token, { password })).ok,
    'Invitation completion must not require a nonexistent old password',
  );
  console.log(
    'Local GoTrue password policy: nonmember invitation completion accepted without old password.',
  );
} finally {
  for (const id of ids)
    assert.ok(
      !(await admin.auth.admin.deleteUser(id)).error,
      'Disposable Auth account cleanup failed',
    );
}
