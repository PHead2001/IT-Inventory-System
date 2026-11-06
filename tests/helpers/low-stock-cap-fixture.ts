import assert from 'node:assert/strict';
import type { Client } from 'pg';

/** Disposable raw cap rows only. Recorded inventory and every reference survive. */
export async function cleanupLowStockCapFixtures(
  owner: Client,
  ids: readonly string[],
  capPrefix: string,
) {
  const connection = (
    owner as unknown as {
      connectionParameters: { host: string; port: number; database: string };
    }
  ).connectionParameters;
  assert.ok(
    connection &&
      ['127.0.0.1', 'localhost', '::1'].includes(connection.host) &&
      connection.port === 45322 &&
      connection.database === 'postgres',
    'cap cleanup requires the canonical local database connection',
  );
  assert.match(
    capPrefix,
    /^LowStock-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} cap-$/,
  );
  assert.ok(ids.length <= 10001 && new Set(ids).size === ids.length);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  if (!ids.length) return [];
  const result = await owner.query<{ id: string }>(
    `delete from public.quantity_items i
     where i.id=any($1::uuid[]) and left(i.name,char_length($2))=$2
      and substring(i.name from char_length($2)+1) ~ '^[0-9]{5}$'
      and i.version=1 and not i.archived and i.custom_values='{}'::jsonb
      and i.description is null and i.manufacturer is null and i.model is null
      and i.reorder_threshold is null
      and not exists(select 1 from public.quantity_events e where e.item_id=i.id)
      and not exists(select 1 from public.stock_balances b where b.item_id=i.id)
      and not exists(select 1 from public.site_quantity_holdings h where h.item_id=i.id)
      and not exists(select 1 from public.assignment_events e where e.item_id=i.id)
      and not exists(select 1 from public.inventory_file_collections c where c.quantity_id=i.id)
      and not exists(select 1 from public.inventory_files f where f.quantity_id=i.id)
      and not exists(select 1 from public.inventory_file_events e where e.quantity_id=i.id)
     returning i.id::text`,
    [ids, capPrefix],
  );
  return result.rows.map((row) => row.id);
}
