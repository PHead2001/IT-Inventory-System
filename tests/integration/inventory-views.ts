import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';
// Validate both endpoints before constructing any client, including pg's owner.
const api = localCommandPaletteTarget(process.env.LOCAL_API_URL, 'api');
const db = localCommandPaletteTarget(process.env.LOCAL_DB_URL, 'database');
assert.ok(process.env.LOCAL_ANON_KEY && process.env.LOCAL_SERVICE_ROLE_KEY);
const apiUrl = new URL(api);
assert.equal(apiUrl.protocol, 'http:');
assert.equal(apiUrl.username, '');
assert.equal(apiUrl.password, '');
assert.equal(apiUrl.pathname, '/');
assert.equal(new URL(db).pathname, '/postgres');
const owner = new Client({
  connectionString: db,
  application_name: 'inventory-views-integration',
  connectionTimeoutMillis: 3000,
  query_timeout: 4000,
});
const ownerFailure = new AbortController();
owner.on('error', () =>
  ownerFailure.abort(new Error('Inventory view owner connection failed')),
);
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const deadline = AbortSignal.timeout(12000);
      return fetch(input, {
        ...init,
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
    },
  },
};
const clients = Object.fromEntries(
  ['staff', 'viewer', 'inactive', 'nonmember'].map((role) => [
    role,
    createClient(api, process.env.LOCAL_ANON_KEY!, options),
  ]),
);
const anonymous = createClient(api, process.env.LOCAL_ANON_KEY, options);
const admin = createClient(api, process.env.LOCAL_SERVICE_ROLE_KEY, options);
const ownedActors: {
  id: string;
  client: (typeof clients)[string];
  membershipMayExist: boolean;
}[] = [];
const prefix = `View-integration-${randomUUID()}`;
const item = randomUUID();
async function read(
  role: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  return clients[role].rpc(name, args);
}
async function cleanupFixture(
  actions: (undefined | (() => Promise<unknown>))[],
) {
  let failed = false;
  for (const action of actions) {
    if (!action) continue;
    try {
      await action();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Inventory view fixture cleanup unproven');
}
async function main() {
  await owner.connect();
  // Read-only version/connection checks precede all authentication and fixture
  // changes. Installed SQL equality still needs exact-source clean-replay proof.
  const expected = readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => name.slice(0, 14));
  assert.ok(expected.length > 0);
  const identity = (
    await owner.query(
      'select current_database() db, current_user usr, ' +
        "'public.quantity_items'::regclass::oid relation_oid, " +
        '(select array_agg(version order by version) from supabase_migrations.schema_migrations) versions',
    )
  ).rows[0];
  assert.equal(identity.db, 'postgres');
  assert.equal(identity.usr, 'postgres');
  assert.ok(
    Number.isSafeInteger(identity.relation_oid) && identity.relation_oid > 0,
  );
  assert.deepEqual(identity.versions, expected);
  for (const [role, client] of Object.entries(clients)) {
    ownerFailure.signal.throwIfAborted();
    const email =
      'inventory-views-' + role + '-' + randomUUID() + '@example.test';
    const created = await admin.auth.admin
      .createUser({ email, password: fixture.password, email_confirm: true })
      .catch(() => undefined);
    if (created?.error || !created?.data.user) {
      // A transport failure may follow a committed create. Report the exact
      // synthetic account for reconciliation when the server did not return its ID.
      throw new Error('Local Auth fixture creation unconfirmed for ' + email);
    }
    const { id } = created.data.user;
    const actor = { id, client, membershipMayExist: false };
    ownedActors.push(actor);
    // The disposable-stack lease establishes same-stack custody before the
    // first write. The new account lets us then cross-check Auth against PG.
    const link = await owner.query(
      'select exists(select 1 from auth.users where id=$1 and email=$2) linked',
      [id, email],
    );
    assert.equal(
      link.rows[0]?.linked,
      true,
      'local Auth and PG must share a test stack',
    );
    if (role !== 'nonmember') {
      actor.membershipMayExist = true;
      await owner.query(
        'insert into public.app_members(user_id,display_name,role,active) values($1,$2,$3,$4)',
        [
          id,
          prefix + ' ' + role,
          role === 'viewer' ? 'viewer' : 'staff',
          role !== 'inactive',
        ],
      );
    }
    const signed = await client.auth.signInWithPassword({
      email,
      password: fixture.password,
    });
    assert.ok(
      !signed.error && signed.data.session,
      'local test account sign-in failed',
    );
  }
  for (const role of ['inactive', 'nonmember'])
    for (const name of [
      'inventory_grouped_page',
      'metadata_inventory_columns',
      'metadata_selected_preview',
    ]) {
      const args =
        name === 'metadata_selected_preview'
          ? { p_keys: [], p_fields: [] }
          : {};
      assert.equal(
        (await read(role, name, args)).error?.code,
        'P1001',
        `${role} is denied ${name}`,
      );
    }
  for (const name of ['inventory_grouped_page', 'metadata_inventory_columns'])
    assert.ok(
      (await anonymous.rpc(name)).error,
      `anonymous cannot invoke ${name}`,
    );
  for (const role of ['staff', 'viewer'])
    assert.equal(
      (await read(role, 'inventory_grouped_page', { p_query: prefix })).error,
      null,
    );
  assert.equal(
    (await read('viewer', 'inventory_view_matches')).error?.code,
    'PGRST202',
    'the matching helper is absent from the public RPC schema',
  );
  assert.equal(
    (await clients.viewer.schema('private').rpc('inventory_view_matches')).error
      ?.code,
    'PGRST106',
    'the private implementation schema is not exposed through Accept-Profile',
  );
  let itemCreated = false;
  let stockCreated = false;
  let snapshotProbeCreated = false;
  let timeoutProbeCreated = false;
  let snapshotLockHeld = false;
  let snapshotDrained: Promise<void> | undefined;
  try {
    const inserted = await owner.query(
      'insert into public.quantity_items(id,name,category_id) select $1,$2,id from public.categories where code=$3',
      [item, prefix, 'CABLES'],
    );
    assert.equal(inserted.rowCount, 1, 'expected one owned fixture item');
    itemCreated = true;
    const location = (
      await owner.query("select id from public.locations where code='ITC-S1A'")
    ).rows[0].id;
    await owner.query(
      'insert into public.stock_balances(item_id,location_id,quantity) values($1,$2,4)',
      [item, location],
    );
    stockCreated = true;
    // Test-only STABLE wrapper holds the same command snapshot across a concurrent write.
    await owner.query(`create function public.inventory_view_snapshot_probe(p_query text) returns jsonb language plpgsql stable set search_path='' set statement_timeout='5s' as $$
     declare first_page jsonb; second_page jsonb; begin first_page:=public.inventory_grouped_page(p_query=>p_query);
     perform pg_catalog.pg_advisory_xact_lock(91081,31); second_page:=public.inventory_grouped_page(p_query=>p_query);
     return jsonb_build_object('first',first_page,'second',second_page); end $$`);
    snapshotProbeCreated = true;
    await owner.query(
      "create function public.inventory_view_timeout_probe() returns text language plpgsql volatile set search_path='' set statement_timeout='100ms' as $$ begin perform pg_catalog.pg_sleep(1); return 'late'; end $$",
    );
    timeoutProbeCreated = true;
    await owner.query(
      'revoke all on function public.inventory_view_snapshot_probe(text),public.inventory_view_timeout_probe() from public,anon,authenticated',
    );
    await owner.query(
      'grant execute on function public.inventory_view_snapshot_probe(text),public.inventory_view_timeout_probe() to authenticated',
    );
    await owner.query("notify pgrst,'reload schema'");
    let hoisted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await read('viewer', 'inventory_view_timeout_probe');
      if (result.error?.code === 'PGRST202') {
        await delay(250);
        continue;
      }
      assert.equal(
        result.error?.code,
        '57014',
        'PostgREST version/configuration must hoist function proconfig timeout before pg_sleep',
      );
      hoisted = true;
      break;
    }
    assert.ok(hoisted, 'REST timeout probe must become available and run');
    await owner.query('select pg_advisory_lock(91081,31)');
    snapshotLockHeld = true;
    const pending = read('viewer', 'inventory_view_snapshot_probe', {
      p_query: prefix,
    });
    // Supabase builders are lazy: explicitly start the HTTP request before writing.
    const started = Promise.resolve(pending);
    snapshotDrained = started.then(
      () => undefined,
      () => undefined,
    );
    let waiting = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      waiting = (
        await owner.query(
          "select exists(select 1 from pg_locks where locktype='advisory' and classid=91081 and objid=31 and not granted) as waiting",
        )
      ).rows[0].waiting;
      if (waiting) break;
      await delay(50);
    }
    assert.ok(
      waiting,
      'concurrent read reached its barrier after taking its first snapshot',
    );
    await owner.query(
      'update public.stock_balances set quantity=5 where item_id=$1 and location_id=$2',
      [item, location],
    );
    await owner.query('select pg_advisory_unlock(91081,31)');
    snapshotLockHeld = false;
    const result = await started;
    assert.equal(result.error, null);
    assert.deepEqual(
      result.data.first,
      result.data.second,
      'count/keys/holdings/totals use a single snapshot',
    );
    assert.equal(result.data.first.rows[0].scoped_storage, '4');
    const later = await read('viewer', 'inventory_grouped_page', {
      p_query: prefix,
    });
    assert.equal(later.data.rows[0].scoped_storage, '5');
  } finally {
    // Cleanup stays sequential on the owner connection and proceeds even when
    // an earlier action fails. Failed creates never confer ownership.
    await cleanupFixture([
      snapshotLockHeld
        ? () => owner.query('select pg_advisory_unlock(91081,31)')
        : undefined,
      () => snapshotDrained ?? Promise.resolve(),
      snapshotProbeCreated
        ? () =>
            owner.query(
              'drop function public.inventory_view_snapshot_probe(text)',
            )
        : undefined,
      timeoutProbeCreated
        ? () =>
            owner.query('drop function public.inventory_view_timeout_probe()')
        : undefined,
      snapshotProbeCreated || timeoutProbeCreated
        ? () => owner.query("notify pgrst,'reload schema'")
        : undefined,
      stockCreated
        ? () =>
            owner.query(
              'update public.stock_balances set quantity=0 where item_id=$1',
              [item],
            )
        : undefined,
      itemCreated
        ? () =>
            owner.query(
              'update public.quantity_items set archived=true where id=$1',
              [item],
            )
        : undefined,
    ]);
  }
}
main()
  .finally(async () => {
    try {
      await owner.end();
    } finally {
      const cleanup = await Promise.allSettled(
        ownedActors.map(async ({ id, client, membershipMayExist }) => {
          // Delete membership first because it restricts deletion of the Auth row.
          // The local admin can clean up the owned fixtures even if pg disconnected.
          try {
            await client.auth.signOut({ scope: 'local' });
          } finally {
            if (membershipMayExist) {
              const membership = await admin
                .from('app_members')
                .delete()
                .eq('user_id', id);
              if (membership.error)
                throw new Error('Inventory view actor cleanup unproven');
            }
            const removed = await admin.auth.admin.deleteUser(id);
            if (removed.error)
              throw new Error('Inventory view actor cleanup unproven');
          }
        }),
      );
      if (cleanup.some((result) => result.status === 'rejected'))
        throw new Error('Inventory view actor cleanup unproven');
    }
  })
  .then(() => {
    ownerFailure.signal.throwIfAborted();
    console.log(
      'Inventory view caller authorization, concurrent snapshot and effective REST timeout checks passed.',
    );
  })
  .catch((error) => {
    console.error(ownerFailure.signal.reason ?? error);
    process.exitCode = 1;
  });
