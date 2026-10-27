// Literal local forward-upgrade regression. Run prepare after
// `supabase db reset --local --version 20260925003000`, then
// `supabase migration up --local`, then verify. Both phases refuse any
// non-loopback database. This fixture is intentionally outside the normal
// post-reset integration suite because it tests a pre-migration state.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const mode = process.argv[2];
assert.ok(
  mode === 'prepare' || mode === 'verify',
  'mode must be prepare or verify',
);
const db = process.env.LOCAL_DB_URL;
assert.ok(db, 'LOCAL_DB_URL required');
const url = new URL(db);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(Number(url.port), 45322);
const owner = new Client({
  connectionString: db,
  application_name: 'custody-forward-upgrade',
});
const email = 'custody-forward-upgrade@example.test';
const quantityName = 'Fictional custody upgrade quantity';
const assetName = 'Fictional custody upgrade asset';

async function authorized<T>(actor: string, fn: () => Promise<T>): Promise<T> {
  await owner.query('begin');
  try {
    await owner.query('set local role authenticated');
    await owner.query('select set_config($1,$2,true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ]);
    const value = await fn();
    await owner.query('commit');
    return value;
  } catch (error) {
    await owner.query('rollback');
    throw error;
  }
}
async function rpc(operation: string, payload: Record<string, unknown>) {
  const { rows } = await owner.query(
    `select public.${operation}($1,$2::jsonb) as result`,
    [randomUUID(), JSON.stringify(payload)],
  );
  return rows[0].result as { entity_id: string; version: number | string };
}
async function main() {
  await owner.connect();
  const migrated = await owner.query(
    "select to_regclass('public.site_quantity_holdings') as relation",
  );
  if (mode === 'prepare') {
    assert.equal(
      migrated.rows[0].relation,
      null,
      'prepare must run before custody migration',
    );
    const actor = randomUUID();
    await owner.query('insert into auth.users(id,email) values($1,$2)', [
      actor,
      email,
    ]);
    await owner.query(
      'insert into public.app_members(user_id,display_name,role,active) values($1,$2,$3,true)',
      [actor, 'Fictional upgrade actor', 'staff'],
    );
    const { rows: categories } = await owner.query(
      "select code,id,published_form_revision_id from public.categories where code in ('CABLES','COMPUTERS')",
    );
    const cable = categories.find(
      (row: { code: string }) => row.code === 'CABLES',
    );
    const computer = categories.find(
      (row: { code: string }) => row.code === 'COMPUTERS',
    );
    assert.ok(cable && computer);
    const { rows: locations } = await owner.query(
      "select code,id from public.locations where code in ('ITC-S1A','ITC-D01')",
    );
    const shelf = locations.find(
      (row: { code: string }) => row.code === 'ITC-S1A',
    )?.id;
    const drawer = locations.find(
      (row: { code: string }) => row.code === 'ITC-D01',
    )?.id;
    assert.ok(shelf && drawer);
    await authorized(actor, async () => {
      await rpc('quantity_create_v2', {
        name: quantityName,
        category_id: cable.id,
        initial_location_id: shelf,
        initial_quantity: 8,
        expected_published_revision_id: cable.published_form_revision_id,
        custom_patch: {},
      });
      await rpc('asset_create_v2', {
        name: assetName,
        category_id: computer.id,
        location_id: drawer,
        expected_published_revision_id: computer.published_form_revision_id,
        custom_patch: {},
      });
    });
    await owner.query(
      "update public.locations set active=false where code in ('ITC-S1A','ITC-D01')",
    );
    console.log(
      'Pre-upgrade inactive storage quantity and active asset fixture prepared locally.',
    );
    return;
  }

  assert.equal(
    migrated.rows[0].relation,
    'site_quantity_holdings',
    'verify must run after custody migration',
  );
  const { rows: users } = await owner.query(
    'select id from auth.users where email=$1',
    [email],
  );
  assert.equal(users.length, 1);
  const actor = users[0].id as string;
  const { rows: items } = await owner.query(
    'select id from public.quantity_items where name=$1',
    [quantityName],
  );
  const { rows: assets } = await owner.query(
    'select id,location_id,site_id from public.serialized_assets where name=$1',
    [assetName],
  );
  assert.equal(items.length, 1);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].site_id, null);
  const { rows: totals } = await owner.query(
    'select available_quantity,assigned_quantity,recorded_quantity from public.inventory_quantity_totals where item_id=$1',
    [items[0].id],
  );
  assert.deepEqual(totals[0], {
    available_quantity: '8',
    assigned_quantity: '0',
    recorded_quantity: '8',
  });
  const { rows: locations } = await owner.query(
    "select code,id,active from public.locations where code in ('ITC-S1A','ITC-D01','ITO-GENERAL')",
  );
  const source = locations.find(
    (row: { code: string }) => row.code === 'ITC-S1A',
  );
  const office = locations.find(
    (row: { code: string }) => row.code === 'ITO-GENERAL',
  );
  assert.ok(source && office && !source.active && office.active);
  await owner.query('begin');
  try {
    await owner.query('set local role authenticated');
    await owner.query('select set_config($1,$2,true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ]);
    await assert.rejects(
      rpc('quantity_receive', {
        item_id: items[0].id,
        expected_version: 1,
        location_id: source.id,
        quantity: 1,
        reason: 'Must reject inactive destination',
      }),
      { code: 'P1004' },
    );
  } finally {
    await owner.query('rollback');
  }
  await authorized(actor, async () => {
    await rpc('quantity_move', {
      item_id: items[0].id,
      expected_version: 1,
      source_location_id: source.id,
      destination_location_id: office.id,
      quantity: 8,
      move_all: false,
      reason: 'Evacuate old inactive shelf',
    });
    await rpc('asset_move', {
      asset_id: assets[0].id,
      expected_version: 1,
      location_id: office.id,
      reason: 'Evacuate old inactive drawer',
    });
  });
  const { rows: final } = await owner.query(
    'select available_quantity,assigned_quantity,recorded_quantity from public.inventory_quantity_totals where item_id=$1',
    [items[0].id],
  );
  assert.deepEqual(final[0], totals[0]);
  const { rows: moved } = await owner.query(
    'select location_id,site_id from public.serialized_assets where id=$1',
    [assets[0].id],
  );
  assert.equal(moved[0].location_id, office.id);
  assert.equal(moved[0].site_id, null);
  console.log(
    'Literal local forward upgrade preserved inactive holdings, rejected new inactive intake and evacuated both inventory types.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await owner.end();
  });
