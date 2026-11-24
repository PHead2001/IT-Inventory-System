import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localCommandPaletteTarget } from '../helpers/local-command-palette-target';

/** Called by the existing canonical custody gate; local-only disposable backend. */
export async function historyToolsProof(input: {
  owner: Client;
  db: string;
  actor: string;
  caller: SupabaseClient;
}) {
  localCommandPaletteTarget(input.db, 'database');
  const { owner, actor, caller } = input;
  const internal = await caller.rpc('inventory_history_matching', {});
  assert.equal(
    internal.error?.code,
    'PGRST202',
    'private matcher has no public Data API route',
  );
  const profile = await caller
    .schema('private')
    .from('inventory_history_event_keys')
    .select('id')
    .limit(1);
  assert.equal(
    profile.error?.code,
    'PGRST106',
    'private Accept-Profile is not exposed',
  );
  const category = (
    await owner.query("select id from public.categories where code='CABLES'")
  ).rows[0].id;
  const prefix = 'History snapshot ' + randomUUID();
  const created = await caller.rpc('quantity_create', {
    p_request_id: randomUUID(),
    p_payload: {
      name: prefix + ' old',
      category_id: category,
      initial_quantity: 0,
      initial_location_id: null,
    },
  });
  assert.equal(created.error, null, created.error?.message);
  const item = (created.data as { entity_id: string }).entity_id;
  const reader = new Client({
    connectionString: input.db,
    application_name: 'history-snapshot-reader',
  });
  const writer = new Client({
    connectionString: input.db,
    application_name: 'history-snapshot-writer',
  });
  await reader.connect();
  await writer.connect();
  const call = 'public.inventory_history_export_snapshot(p_entity_id=>$1)';
  try {
    await writer.query('begin');
    await writer.query(
      'update public.quantity_items set name=$2,version=version+1 where id=$1',
      [item, prefix + ' new'],
    );
    await writer.query(
      `insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,before_metadata,after_metadata)
      values($1,'metadata_updated',$2,'Snapshot actor',2,jsonb_build_object('name',$3::text),jsonb_build_object('name',$4::text))`,
      [item, actor, prefix + ' old', prefix + ' new'],
    );
    await reader.query('begin isolation level read committed');
    await reader.query('set local role authenticated');
    await reader.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ]);
    const pid = (await reader.query('select pg_backend_pid() pid')).rows[0].pid;
    const pending = reader.query(
      `with first as materialized(select ${call} doc),
      pause as materialized(select pg_sleep(1.2) from first),
      second as materialized(select ${call} doc from pause)
      select first.doc before_doc,second.doc after_doc from first cross join second`,
      [item],
    );
    let paused = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await owner.query(
        'select wait_event from pg_stat_activity where pid=$1',
        [pid],
      );
      if (state.rows[0]?.wait_event === 'PgSleep') {
        paused = true;
        break;
      }
      await delay(25);
    }
    assert.ok(
      paused,
      'writer commits while one SQL statement snapshot is retained',
    );
    await writer.query('commit');
    const snapshots = (await pending).rows[0];
    assert.deepEqual(
      snapshots.before_doc,
      snapshots.after_doc,
      'events, identities, labels and counts agree across a concurrent commit',
    );
    assert.equal(snapshots.before_doc.event_count, 1);
    assert.equal(snapshots.before_doc.rows[0].name_current, prefix + ' old');
    const next = (await reader.query(`select ${call} doc`, [item])).rows[0].doc;
    assert.equal(next.event_count, 2);
    assert.equal(next.rows[0].name_current, prefix + ' new');
    assert.notEqual(
      next.exported_at,
      snapshots.before_doc.exported_at,
      'a later download reports its own snapshot instant',
    );
    await reader.query('rollback');

    // Effective timeout on the actual Data API RPC, with its real proconfig.
    // Save/restore the exact function definition; no production/shared backend.
    const signature =
      'public.inventory_history_export_snapshot(text,uuid,text,text,uuid,text,timestamptz,timestamptz)';
    const original = (
      await owner.query(
        'select pg_get_functiondef($1::regprocedure) definition',
        [signature],
      )
    ).rows[0].definition as string;
    const delayed = original.replace(
      /\bbegin\s*\n/i,
      'begin\n perform pg_catalog.pg_sleep(6);\n',
    );
    assert.notEqual(delayed, original, 'timeout injection anchor exists');
    await owner.query(delayed);
    await owner.query("notify pgrst,'reload schema'");
    try {
      let result: { error: { code?: string } | null } | null = null;
      let elapsed = 0;
      for (let attempt = 0; attempt < 12; attempt++) {
        const started = performance.now();
        result = await caller.rpc('inventory_history_export_snapshot', {
          p_entity_id: item,
        });
        elapsed = performance.now() - started;
        if (result.error?.code !== 'PGRST202') break;
        await delay(250);
      }
      assert.equal(
        result?.error?.code,
        '57014',
        'PostgREST hoists actual history RPC timeout before execution',
      );
      assert.ok(
        elapsed >= 4500 && elapsed < 7500,
        `effective five-second timeout observed: ${elapsed}ms`,
      );
    } finally {
      await owner.query(original);
      await owner.query("notify pgrst,'reload schema'");
    }
  } finally {
    await Promise.allSettled([
      reader.query('rollback'),
      writer.query('rollback'),
    ]);
    await Promise.allSettled([reader.end(), writer.end()]);
    const current = (
      await owner.query(
        'select version,archived from public.quantity_items where id=$1',
        [item],
      )
    ).rows[0];
    if (current && !current.archived) {
      const cleanup = await caller.rpc('quantity_archive', {
        p_request_id: randomUUID(),
        p_payload: {
          item_id: item,
          expected_version: current.version,
          reason: 'History tools integration cleanup',
        },
      });
      assert.equal(cleanup.error, null, cleanup.error?.message);
    }
  }
}
