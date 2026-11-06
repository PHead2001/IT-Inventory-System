import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';
// Validate both endpoints before constructing any client, including pg's owner.
const api = localCommandPaletteTarget(process.env.LOCAL_API_URL, 'api');
const db = localCommandPaletteTarget(process.env.LOCAL_DB_URL, 'database');
assert.ok(process.env.LOCAL_ANON_KEY);
const owner = new Client({
  connectionString: db,
  application_name: 'inventory-views-integration',
});
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const clients = Object.fromEntries(
  ['staff', 'viewer', 'inactive', 'nonmember'].map((role) => [
    role,
    createClient(api, process.env.LOCAL_ANON_KEY!, options),
  ]),
);
const anonymous = createClient(api, process.env.LOCAL_ANON_KEY, options);
const prefix = `View-integration-${randomUUID()}`;
const item = randomUUID();
async function read(
  role: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  return clients[role].rpc(name, args);
}
async function main() {
  await owner.connect();
  for (const [role, client] of Object.entries(clients)) {
    const result = await client.auth.signInWithPassword({
      email: fixture.emails[role as keyof typeof fixture.emails],
      password: fixture.password,
    });
    assert.equal(result.error, null);
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
  await owner.query(
    'insert into public.quantity_items(id,name,category_id) select $1,$2,id from public.categories where code=$3',
    [item, prefix, 'CABLES'],
  );
  const location = (
    await owner.query("select id from public.locations where code='ITC-S1A'")
  ).rows[0].id;
  await owner.query(
    'insert into public.stock_balances(item_id,location_id,quantity) values($1,$2,4)',
    [item, location],
  );
  // Test-only STABLE wrapper holds the same command snapshot across a concurrent write.
  await owner.query(`create function public.inventory_view_snapshot_probe(p_query text) returns jsonb language plpgsql stable set search_path='' set statement_timeout='5s' as $$
   declare first_page jsonb; second_page jsonb; begin first_page:=public.inventory_grouped_page(p_query=>p_query);
   perform pg_catalog.pg_advisory_xact_lock(91081,31); second_page:=public.inventory_grouped_page(p_query=>p_query);
   return jsonb_build_object('first',first_page,'second',second_page); end $$`);
  await owner.query(
    "create function public.inventory_view_timeout_probe() returns text language plpgsql volatile set search_path='' set statement_timeout='100ms' as $$ begin perform pg_catalog.pg_sleep(1); return 'late'; end $$",
  );
  try {
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
    const pending = read('viewer', 'inventory_view_snapshot_probe', {
      p_query: prefix,
    });
    // Supabase builders are lazy: explicitly start the HTTP request before writing.
    const started = Promise.resolve(pending);
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
    await owner.query('select pg_advisory_unlock(91081,31)');
    await owner.query(
      'drop function public.inventory_view_snapshot_probe(text),public.inventory_view_timeout_probe()',
    );
    await owner.query("notify pgrst,'reload schema'");
    await owner.query(
      'update public.stock_balances set quantity=0 where item_id=$1',
      [item],
    );
    await owner.query(
      'update public.quantity_items set archived=true where id=$1',
      [item],
    );
  }
  console.log(
    'Inventory view caller authorization, concurrent snapshot and effective REST timeout checks passed.',
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      Object.values(clients).map((client) =>
        client.auth.signOut({ scope: 'local' }),
      ),
    );
    await owner.end();
  });
