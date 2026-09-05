import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { loadItCloset } from '../../src/features/room/load';
import type { RoomNode } from '../../src/features/room/schema';
import { expectedCategories, expectedLocations } from '../fixtures/reference';
import { canHoldInventory } from '../../src/features/locations/eligibility';

async function main() {
  const url = new URL(process.env.LOCAL_API_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  const admin = createClient(url.href, process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const [{ data: locations, error: le }, { data: categories, error: ce }] =
    await Promise.all([
      admin.from('locations').select('*'),
      admin.from('categories').select('*').order('sort_order'),
    ]);
  assert.equal(le, null);
  assert.equal(ce, null);
  assert.ok(locations);
  assert.ok(categories);
  assert.deepEqual(
    categories.map((c) => c.name),
    expectedCategories,
  );
  assert.equal(locations.length, 35);
  const byCode = new Map(locations.map((l) => [l.code, l]));
  const byId = new Map(locations.map((l) => [l.id, l]));
  for (const [code, name, parent, kind, cap, sort] of expectedLocations) {
    const actual = byCode.get(code);
    assert.ok(actual, code);
    assert.equal(actual.name, name);
    assert.equal(actual.kind, kind);
    assert.equal(actual.can_hold_inventory, cap);
    assert.equal(actual.sort_order, sort);
    assert.equal(
      actual.parent_id ? byId.get(actual.parent_id)?.code : null,
      parent,
    );
  }
  assert.equal(locations.filter(canHoldInventory).length, 28);
  const room = loadItCloset(),
    bound = new Set([room.locationCode]),
    primary = new Set<string>();
  const visit = (nodes: RoomNode[], parent: string) => {
    for (const n of nodes) {
      let nextParent = parent;
      if (n.locationCode) {
        assert.ok(
          !bound.has(n.locationCode),
          'duplicate logical binding ' + n.locationCode,
        );
        bound.add(n.locationCode);
        const loc = byCode.get(n.locationCode);
        assert.ok(loc, 'unknown binding ' + n.locationCode);
        assert.equal(
          byId.get(loc.parent_id)?.code,
          parent,
          'logical parent binding',
        );
        assert.equal(
          n.interaction?.primaryBinding ?? false,
          loc.can_hold_inventory,
          'destination binding capability',
        );
        if (n.interaction?.primaryBinding) primary.add(n.locationCode);
        nextParent = n.locationCode;
      }
      visit(n.children ?? [], nextParent);
    }
  };
  visit(room.nodes, room.locationCode);
  assert.equal(bound.size, 35);
  assert.deepEqual(
    [...primary].sort(),
    locations
      .filter((l) => l.can_hold_inventory)
      .map((l) => l.code)
      .sort(),
  );
  // Privileged hierarchy edits also serialize stale snapshots.
  const a = new Client({ connectionString: process.env.LOCAL_DB_URL });
  const b = new Client({ connectionString: process.env.LOCAL_DB_URL });
  await a.connect();
  await b.connect();
  try {
    await a.query('begin');
    await b.query('begin isolation level repeatable read');
    await b.query('select count(*) from public.locations');
    await a.query("update public.locations set name=name where code='ITC-D01'");
    const competing = b
      .query("update public.locations set name=name where code='ITC-D02'")
      .then(
        () => null,
        (error) => error,
      );
    await a.query('commit');
    const error = await competing;
    assert.equal(error?.code, '40001', 'stale hierarchy writer must abort');
    await b.query('rollback');
  } finally {
    await a.end();
    await b.end();
  }
  console.log(
    'Exact reference seeds, room/database bindings, capabilities, and hierarchy concurrency passed.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
