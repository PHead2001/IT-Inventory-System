import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';

// This gate deliberately locks a shared table in a disposable LOCAL database.
// It must never accept a preview or production connection string.
const api = localCommandPaletteTarget(process.env.LOCAL_API_URL, 'api');
const database = localCommandPaletteTarget(
  process.env.LOCAL_DB_URL,
  'database',
);
assert.ok(process.env.LOCAL_ANON_KEY && process.env.LOCAL_SERVICE_ROLE_KEY);
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: ((input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.any([
          AbortSignal.timeout(12000),
          ...(input instanceof Request ? [input.signal] : []),
          ...(init?.signal ? [init.signal] : []),
        ]),
      })) satisfies typeof fetch,
  },
};
const admin = createClient(api, process.env.LOCAL_SERVICE_ROLE_KEY, options);
const caller = createClient(api, process.env.LOCAL_ANON_KEY, options);
const owner = new Client({
  connectionString: database,
  connectionTimeoutMillis: 3000,
  query_timeout: 4000,
});
const blocker = new Client({
  connectionString: database,
  connectionTimeoutMillis: 3000,
  query_timeout: 4000,
});
let actor: string | undefined;
let release: ReturnType<typeof setTimeout> | undefined;
let lockReleasedEarly = false;
try {
  await owner.connect();
  await blocker.connect();
  const created = await admin.auth.admin.createUser({
    email: 'palette-timeout-' + randomUUID() + '@example.test',
    password: authFixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null, 'Owned timeout actor creation failed');
  actor = created.data.user!.id;
  await owner.query(
    'insert into public.app_members(user_id,display_name,role) values($1,$2,$3)',
    [actor, 'Palette timeout fixture', 'viewer'],
  );
  const session = await caller.auth.signInWithPassword({
    email: created.data.user!.email!,
    password: authFixture.password,
  });
  assert.equal(session.error, null, 'Owned timeout caller sign-in failed');
  const normal = await caller
    .rpc('command_palette_search_v1', { p_query: '' })
    .abortSignal(AbortSignal.timeout(12000));
  assert.equal(
    normal.error,
    null,
    'Authenticated RPC must work before blocking',
  );

  // Database and client fail-safes release the lock even when an assertion fails.
  await blocker.query("set idle_in_transaction_session_timeout = '10s'");
  await blocker.query("set lock_timeout = '2s'");
  await blocker.query('begin');
  await blocker.query(
    'lock table public.serialized_assets in access exclusive mode',
  );
  release = setTimeout(() => {
    lockReleasedEarly = true;
    void blocker.query('rollback').catch(() => blocker.end().catch(() => {}));
  }, 9000);
  const deadline = AbortSignal.timeout(12000);
  const started = performance.now();
  const pending = Promise.resolve(
    caller
      .rpc('command_palette_search_v1', {
        p_query: 'PaletteTimeout-' + randomUUID(),
      })
      .abortSignal(deadline),
  );
  let witnessed = false;
  const observeUntil = performance.now() + 2000;
  while (performance.now() < observeUntil) {
    const observed = await owner.query(
      "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%command_palette_search_v1%' and pid<>pg_backend_pid()) blocked",
    );
    if (observed.rows[0].blocked) {
      witnessed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const result = await pending;
  const elapsed = performance.now() - started;
  assert.ok(
    witnessed,
    'The real RPC must be observed waiting for the independent lock',
  );
  assert.equal(
    result.error?.code,
    '57014',
    'Require a database cancellation, not a client abort',
  );
  assert.match(result.error?.message ?? '', /statement timeout/i);
  assert.ok(
    !deadline.aborted,
    'Database timeout must precede the client deadline',
  );
  assert.ok(
    !lockReleasedEarly,
    'Database timeout must precede forced lock release',
  );
  assert.ok(
    elapsed >= 4500 && elapsed < 7500,
    'The configured five-second RPC timeout must be enforced',
  );
  console.log(
    'Command palette authenticated Data API timeout proof passed; database 57014 after ' +
      Math.round(elapsed) +
      'ms.',
  );
} finally {
  if (release) clearTimeout(release);
  await blocker.query('rollback').catch(() => {});
  await blocker.end().catch(() => {});
  if (actor) {
    await owner
      .query('delete from public.app_members where user_id=$1', [actor])
      .catch(() => {});
    try {
      const removed = await admin.auth.admin.deleteUser(actor);
      assert.equal(removed.error, null, 'Owned timeout actor cleanup failed');
    } finally {
      await owner.end();
    }
  } else {
    await owner.end();
  }
}
