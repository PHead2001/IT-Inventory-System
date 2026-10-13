import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

async function verifyFreshMigrationConnection(connection: Client) {
  const migration = readFileSync(
    new URL(
      '../../supabase/migrations/20261013162931_command_palette_breadcrumb_context.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const parts = migration.match(
    /^([\s\S]*?)(create or replace function public\.command_palette_search_v1\([\s\S]*?) as \$\$/,
  );
  assert.ok(
    parts,
    'The actual breadcrumb migration must contain its RPC header',
  );
  const probe =
    parts[2].replace(
      'public.command_palette_search_v1',
      'pg_temp.command_palette_migration_probe',
    ) +
    " as $$ begin return jsonb_build_object('threshold',current_setting('pg_trgm.word_similarity_threshold')); end; $$;";
  try {
    await connection.query('begin');
    await connection.query('set local role authenticated');
    const role = await connection.query(
      'select rolsuper from pg_roles where rolname=current_user',
    );
    assert.equal(role.rows[0].rolsuper, false, 'Probe must use a nonsuperuser');
    await connection.query(
      'create temporary table palette_migration_probe(id int)',
    );
    const before = await connection.query(
      "select context from pg_settings where name='pg_trgm.word_similarity_threshold'",
    );
    assert.equal(
      before.rowCount,
      0,
      'Fresh backend must not have loaded pg_trgm',
    );
    await connection.query('savepoint unregistered_parameter');
    await assert.rejects(connection.query(probe), {
      code: '42501',
      message:
        'permission denied to set parameter "pg_trgm.word_similarity_threshold"',
    });
    await connection.query('rollback to savepoint unregistered_parameter');
    // Execute the repository prefix, not a duplicated load statement. Omitting
    // it reproduces the provider's failure despite the extension being installed.
    await connection.query(parts[1]);
    const loaded = await connection.query(
      "select context,setting from pg_settings where name='pg_trgm.word_similarity_threshold'",
    );
    assert.equal(loaded.rows[0].context, 'user');
    const defaultThreshold = loaded.rows[0].setting;
    await connection.query(probe);
    const result = await connection.query(
      "select pg_temp.command_palette_migration_probe('probe')->>'threshold' threshold",
    );
    assert.equal(Number(result.rows[0].threshold), 0.35);
    const restored = await connection.query(
      "select setting from pg_settings where name='pg_trgm.word_similarity_threshold'",
    );
    assert.equal(restored.rows[0].setting, defaultThreshold);
  } finally {
    await connection.query('rollback');
  }
}

async function verifyFreshAuthenticatedSearch(member: string) {
  const connection = new Client({
    connectionString: database,
    connectionTimeoutMillis: 3000,
    query_timeout: 7000,
  });
  try {
    await connection.connect();
    await connection.query('begin');
    await connection.query('set local role authenticated');
    const before = await connection.query(
      "select context from pg_settings where name='pg_trgm.word_similarity_threshold'",
    );
    assert.equal(
      before.rowCount,
      0,
      'Caller must start without loaded pg_trgm',
    );
    await connection.query('savepoint nonmember');
    await assert.rejects(
      connection.query(
        "select public.command_palette_search_v1('fresh backend')",
      ),
      { code: 'P1001', message: 'forbidden' },
    );
    await connection.query('rollback to savepoint nonmember');
    await connection.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: member, role: 'authenticated' }),
    ]);
    const result = await connection.query(
      "select public.command_palette_search_v1('fresh backend') answer",
    );
    assert.equal(result.rows[0].answer.version, 1);
    assert.ok(Array.isArray(result.rows[0].answer.rows));
    const loaded = await connection.query(
      "select context from pg_settings where name='pg_trgm.word_similarity_threshold'",
    );
    assert.equal(loaded.rows[0].context, 'user');
  } finally {
    await connection.query('rollback').catch(() => {});
    await connection.end();
  }
}

try {
  await owner.connect();
  await blocker.connect();
  await verifyFreshMigrationConnection(owner);
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
  await verifyFreshAuthenticatedSearch(actor);
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
