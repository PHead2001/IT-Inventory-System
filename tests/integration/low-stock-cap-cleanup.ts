import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';
import { cleanupLowStockCapFixtures } from '../helpers/low-stock-cap-fixture';

const owner = new Client({
  connectionString: localCommandPaletteTarget(
    process.env.LOCAL_DB_URL,
    'database',
  ),
  application_name: 'low-stock-cap-cleanup-contract',
  connectionTimeoutMillis: 3000,
  query_timeout: 5000,
});
const prefix = `LowStock-${randomUUID()} cap-`;
const ids = Array.from({ length: 6 }, () => randomUUID());
await owner.connect();
await owner.query('begin');
try {
  const actor = randomUUID();
  await owner.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    `cap-cleanup-${actor}@example.test`,
  ]);
  await owner.query(
    "insert into public.app_members(user_id,display_name,role) values($1,'Fictional cleanup actor','staff')",
    [actor],
  );
  for (const [index, id] of ids.entries())
    await owner.query(
      `insert into public.quantity_items(id,name,category_id,description)
       values($1,$2,(select id from public.categories where code='CABLES'),$3)`,
      [
        id,
        index === 4
          ? 'Unowned cleanup record'
          : prefix + String(index + 1).padStart(5, '0'),
        index === 3 ? 'Changed descriptive values' : null,
      ],
    );
  await owner.query(
    "insert into public.quantity_events(item_id,kind,actor_id,actor_name,version) values($1,'created',$2,'Fictional cleanup actor',1)",
    [ids[1], actor],
  );
  await owner.query(
    "insert into public.stock_balances(item_id,location_id,quantity) select $1,id,0 from public.locations where code='ITC-S1A'",
    [ids[2]],
  );
  assert.deepEqual(
    await cleanupLowStockCapFixtures(owner, ids.slice(0, 5), prefix),
    [ids[0]],
    'only the exact owned raw unreferenced row may be deleted',
  );
  const retained = await owner.query<{ id: string }>(
    'select id::text from public.quantity_items where id=any($1::uuid[]) order by id',
    [ids],
  );
  assert.deepEqual(
    retained.rows.map((row) => row.id),
    ids.slice(1).sort(),
  );
  assert.equal(
    (
      await owner.query(
        'select count(*)::integer as n from public.quantity_events where item_id=$1',
        [ids[1]],
      )
    ).rows[0].n,
    1,
    'recorded history is preserved',
  );
  await assert.rejects(() =>
    cleanupLowStockCapFixtures(owner, [ids[5], ids[5]], prefix),
  );
  await assert.rejects(() =>
    cleanupLowStockCapFixtures(owner, [ids[5]], 'LowStock- broad'),
  );
  await assert.rejects(() =>
    cleanupLowStockCapFixtures(
      {
        connectionParameters: {
          host: 'remote.example.test',
          port: 45322,
          database: 'postgres',
        },
      } as unknown as Client,
      [ids[5]],
      prefix,
    ),
  );
  console.log(
    'Local cap cleanup preserves history, zero holdings, edits, foreign prefixes and unlisted identities.',
  );
} finally {
  await owner.query('rollback');
  await owner.end();
}
