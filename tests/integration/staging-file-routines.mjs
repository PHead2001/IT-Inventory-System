// Disposable loopback catalog regression, called by the canonical DB gate.
// Every mutation is rolled back, including when an assertion fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import manifest from '../../scripts/staging-file-routines.json' with { type: 'json' };
import { STAGING_SCHEMA_SQL } from '../../scripts/staging-file-keys-providers.mjs';
import { compareLocalStagingRoutineManifest } from '../../scripts/staging-file-routine-check.mjs';
import {
  STAGING_ROUTINE_CATALOG_SQL,
  STAGING_TRIGGER_CATALOG_SQL,
  STAGING_STORAGE_CATALOG_SQL,
  STAGING_STORAGE_PROVIDER_BASELINE,
  STAGING_FILE_API_COMPARISON_SQL,
} from '../../scripts/staging-file-routines.mjs';

const migrationBody = (filename, name) => {
  const sql = readFileSync(
    new URL(`../../supabase/migrations/${filename}`, import.meta.url),
    'utf8',
  );
  const start = sql.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const bodyStart = sql.indexOf('$$', start) + 2;
  const bodyEnd = sql.indexOf('$$;', bodyStart);
  assert.ok(bodyStart > 1 && bodyEnd > bodyStart);
  return sql.slice(bodyStart, bodyEnd);
};

// Protected Storage DDL is a disposable-local fault fixture. Ordinary readiness
// observations still execute as postgres; owner drift fixtures are rolled back.
export function localStorageFixture(
  sql,
  { environment = process.env, execute = execFileSync } = {},
) {
  const target = new URL(environment.LOCAL_DB_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(target.port, '54322');
  assert.equal(target.pathname, '/postgres');
  const container = 'supabase_db_it-inventory';
  const childEnv = { ...environment };
  // Resolve Docker's actual context-over-host precedence without contacting a
  // server. All later daemon commands use that validated endpoint explicitly.
  delete childEnv.DOCKER_CONTEXT;
  delete childEnv.DOCKER_HOST;
  const run = (args, options = {}) => {
    try {
      return execute('docker', args, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 1048576,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
        ...options,
      });
    } catch (error) {
      const state = /ERROR:\s+([A-Z0-9]{5})\b/.exec(
        error.stderr?.toString() ?? '',
      )?.[1];
      throw new Error(
        `Disposable local Storage fixture refused (${state ?? 'transport'}); connection closes and rolls back`,
      );
    }
  };
  const endpoint = environment.DOCKER_CONTEXT
    ? JSON.parse(
        run([
          'context',
          'inspect',
          environment.DOCKER_CONTEXT,
          '--format',
          '{{json .Endpoints.docker.Host}}',
        ]),
      )
    : environment.DOCKER_HOST ||
      JSON.parse(
        run([
          'context',
          'inspect',
          '--format',
          '{{json .Endpoints.docker.Host}}',
        ]),
      );
  const unix =
    typeof endpoint === 'string' && endpoint.startsWith('unix:///')
      ? new URL(endpoint)
      : null;
  assert.ok(
    typeof endpoint === 'string' &&
      (/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(endpoint) ||
        (unix &&
          !unix.hostname &&
          !unix.username &&
          !unix.password &&
          !unix.port &&
          !unix.search &&
          !unix.hash)),
    'fixture Docker socket must be local',
  );
  const inspected = JSON.parse(
    run([
      '--host',
      endpoint,
      'inspect',
      '--type',
      'container',
      container,
      '--format',
      '{"name":{{json .Name}},"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}},"running":{{json .State.Running}}}',
    ]),
  );
  assert.equal(inspected.name, '/supabase_db_it-inventory');
  assert.equal(inspected.labels['com.supabase.cli.project'], 'it-inventory');
  assert.equal(inspected.running, true);
  const ports = inspected.ports['5432/tcp'];
  assert.ok(
    Array.isArray(ports) &&
      ports.length > 0 &&
      ports.every((port) => port.HostPort === '54322'),
  );
  const input = `set application_name='cp5-storage-binding-${randomUUID()}';
begin;
set local statement_timeout='10s';
set local lock_timeout='2s';
set local idle_in_transaction_session_timeout='5s';
set local role postgres;
${sql}
rollback;
`;
  // Container-side timeout kills psql itself, even if the Docker client loses
  // its response. EOF/ON_ERROR_STOP/termination closes the socket transaction.
  const output = run(
    [
      '--host',
      endpoint,
      'exec',
      '-i',
      container,
      'timeout',
      '20s',
      'psql',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
    ],
    { input },
  );
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const storageObservation = (phase) => `select pg_catalog.json_build_object(
  'phase','${phase}','user',current_user,'ready',q.ready,
  'routines',(select pg_catalog.jsonb_agg(r.routine order by r.routine->>'signature') from (${STAGING_ROUTINE_CATALOG_SQL}) r),
  'triggers',(select pg_catalog.jsonb_agg(t.binding order by t.binding->>'name' collate "C") from (${STAGING_TRIGGER_CATALOG_SQL}) t),
  'storage',(select storage_contract from (${STAGING_STORAGE_CATALOG_SQL}) s)
) from (${STAGING_SCHEMA_SQL}) q;`;
export async function verifyStagingRoutineContract(db) {
  let checks = 0;
  const ready = async () => (await db.query(STAGING_SCHEMA_SQL)).rows[0].ready;
  const catalog = async () =>
    (await db.query(STAGING_ROUTINE_CATALOG_SQL)).rows.map(
      (row) => row.routine,
    );
  const triggers = async () =>
    (await db.query(STAGING_TRIGGER_CATALOG_SQL)).rows.map(
      (row) => row.binding,
    );
  const storage = async () =>
    (await db.query(STAGING_STORAGE_CATALOG_SQL)).rows[0].storage_contract;
  const fixtureConnectionsClosed = async () => {
    const { rows } = await db.query(
      "select pg_catalog.count(*)::int connections from pg_catalog.pg_stat_activity where application_name like 'cp5-storage-binding-%'",
    );
    assert.equal(
      rows[0].connections,
      0,
      'bounded socket fixture leaves no open backend connection',
    );
    checks++;
  };
  assert.equal(
    (await db.query(`select ${STAGING_FILE_API_COMPARISON_SQL} as ready`))
      .rows[0].ready,
    true,
    'fresh canonical catalog has only the reviewed public file API',
  );
  await compareLocalStagingRoutineManifest(
    {
      version: 5,
      routines: await catalog(),
      triggers: await triggers(),
      storage: await storage(),
    },
    manifest,
    process.env.LOCAL_DB_URL,
  );
  assert.deepEqual(
    await triggers(),
    manifest.triggers,
    'canonical Storage trigger matches reviewed binding',
  );
  assert.equal(await ready(), true, 'canonical schema ready');
  assert.deepEqual(
    await storage(),
    manifest.storage,
    'canonical complete Storage authorization matches',
  );
  checks += 4;
  const definition = async (signature) =>
    (
      await db.query(
        'select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure($1)) definition,prosrc source from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure($1)',
        [signature],
      )
    ).rows[0];
  const replaceBody = async (signature, change) => {
    const { definition: sql, source } = await definition(signature);
    assert.ok(sql.includes(source));
    await db.query(sql.replace(source, () => change(source)));
  };
  const rejected = async (note, mutate) => {
    await db.query('begin');
    try {
      await mutate();
      assert.equal(await ready(), false, note);
      checks++;
    } finally {
      await db.query('rollback');
      assert.equal(
        await ready(),
        true,
        'tamper fixture restores canonical readiness',
      );
      checks++;
    }
  };
  for (const expected of manifest.routines) {
    if (expected.signature.startsWith('storage.')) {
      const { definition: sql, source } = await definition(expected.signature);
      try {
        const observations = localStorageFixture(
          `reset role; ${sql.replace(source, () => source + '\n-- provider body drift fixture\n')}; set local role postgres; ${storageObservation('tampered')}`,
        );
        const changed = observations[0].routines.find(
          (row) => row.signature === expected.signature,
        );
        assert.equal(
          observations[0].ready,
          false,
          'provider body drift is refused',
        );
        assert.notEqual(changed.body_sha256, expected.body_sha256);
        assert.deepEqual(
          { ...changed, body_sha256: expected.body_sha256 },
          expected,
          'provider fixture preserves original owner/ACL/metadata',
        );
        checks += 3;
      } finally {
        assert.equal(await ready(), true);
        checks++;
        await fixtureConnectionsClosed();
      }
      continue;
    }
    await rejected(
      `same-signature body drift denied: ${expected.signature}`,
      async () => {
        await replaceBody(
          expected.signature,
          (source) => source + '\n-- same-signature tamper fixture\n',
        );
        const changed = (await catalog()).find(
          (row) => row.signature === expected.signature,
        );
        assert.notEqual(changed.body_sha256, expected.body_sha256);
        assert.deepEqual(
          { ...changed, body_sha256: expected.body_sha256 },
          expected,
          'body fixture preserves every signature/metadata/grant field',
        );
        checks += 2;
      },
    );
  }
  for (const signature of [
    'public.inventory_file_cancel(uuid)',
    'public.inventory_file_remove(uuid,bigint,bigint,uuid)',
    'public.inventory_file_rename(uuid,bigint,bigint,text,uuid)',
    'public.inventory_file_read(uuid,text)',
    'public.inventory_file_cards(text,uuid)',
    'public.inventory_file_history(text,uuid,integer)',
    'public.inventory_file_list_thumbnails(uuid[],uuid[])',
  ]) {
    await rejected(`new file API ACL drift refused: ${signature}`, async () => {
      await db.query(`grant execute on function ${signature} to anon`);
    });
  }
  for (const { signature } of STAGING_STORAGE_PROVIDER_BASELINE) {
    try {
      const rows = localStorageFixture(
        `reset role; revoke execute on function ${signature} from public; set local role postgres; ${storageObservation('tampered')}`,
      );
      assert.equal(rows[0].ready, false, 'provider ACL drift refused');
      checks++;
    } finally {
      assert.equal(await ready(), true);
      checks++;
      await fixtureConnectionsClosed();
    }
  }
  await rejected(
    'unreviewed public file API addition requires explicit review',
    async () => {
      await db.query(
        "create function public.inventory_file_unreviewed(uuid) returns boolean language sql set search_path='' as $$ select true $$",
      );
    },
  );
  await rejected(
    'swapped formal argument names cannot reverse positional helper semantics',
    async () => {
      const signature = 'private.file_collection_lock(uuid,uuid)';
      const { definition: sql } = await definition(signature);
      assert.ok(sql.includes('p_asset uuid, p_quantity uuid'));
      await db.query(`drop function ${signature}`);
      await db.query(
        sql.replace(
          'p_asset uuid, p_quantity uuid',
          'p_quantity uuid, p_asset uuid',
        ),
      );
      await db.query(
        `revoke all on function ${signature} from public,anon,authenticated,service_role`,
      );
      const expected = manifest.routines.find(
        (row) => row.signature === signature,
      );
      const changed = (await catalog()).find(
        (row) => row.signature === signature,
      );
      assert.deepEqual(changed.argument_names, ['p_quantity', 'p_asset']);
      assert.deepEqual(
        { ...changed, argument_names: expected.argument_names },
        expected,
        'recreated routine retains body hash/signature/grants and every other pinned field',
      );
      checks += 2;
    },
  );
  for (const [note, signature, body] of [
    [
      'cleanup claim retains transaction-start lease timing',
      'public.inventory_file_cleanup_claim_parent(text,uuid,integer,text,text,bigint,text)',
      migrationBody(
        '20261005142029_parent_scoped_file_readiness.sql',
        'public.inventory_file_cleanup_claim_parent',
      ),
    ],
    [
      'cleanup status retains transaction-start lease timing',
      'public.inventory_file_cleanup_status(text,uuid)',
      migrationBody(
        '20261005142029_parent_scoped_file_readiness.sql',
        'public.inventory_file_cleanup_status',
      ),
    ],
    [
      'cleanup confirmation retains transaction-start lease enforcement',
      'public.inventory_file_cleanup_confirm(uuid,text,text,bigint,text)',
      migrationBody(
        '20260925153015_integrated_private_files.sql',
        'public.inventory_file_cleanup_confirm',
      ),
    ],
    [
      'Storage DELETE retains transaction-start lease enforcement',
      'private.file_storage_delete(text,text)',
      migrationBody(
        '20260925153015_integrated_private_files.sql',
        'private.file_storage_delete',
      ),
    ],
    [
      'old additive accounting body',
      'private.file_staging_bytes(timestamptz)',
      migrationBody(
        '20261005153057_file_pending_capacity_accounting.sql',
        'private.file_staging_bytes',
      ),
    ],
    [
      'no-op parent authorization',
      'private.file_parent_staff(text,uuid)',
      '\nbegin return; end\n',
    ],
    [
      'unscoped global cleanup',
      'public.inventory_file_cleanup_claim_parent(text,uuid,integer,text,text,bigint,text)',
      migrationBody(
        '20260925153015_integrated_private_files.sql',
        'public.inventory_file_cleanup_claim',
      ),
    ],
    [
      'reservation bypasses server proof',
      'public.inventory_file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint,text,text,bigint,text)',
      '\nbegin return private.file_reserve_ready(p_parent_type,p_parent_id,p_expected_revision,p_name,p_type,p_bytes,p_replaces,p_expected_file_version); end\n',
    ],
    [
      'no-op privileged Storage completion guard',
      'private.inventory_file_storage_completion_guard()',
      '\nbegin return new; end\n',
    ],
    [
      'finalization bypasses attestation, generation and revision validation',
      'public.inventory_file_finalize(uuid,bigint,uuid)',
      "\nbegin update public.inventory_files set state='ready' where id=p_file_id; return '{}'::jsonb; end\n",
    ],
    [
      'accounting reports zero bytes',
      'private.file_staging_bytes(timestamptz)',
      '\nselect 0::bigint\n',
    ],
  ]) {
    await rejected(note, () => replaceBody(signature, () => body));
  }
  for (const [note, sql] of [
    [
      'strictness drift',
      'alter function private.file_parent_staff(text,uuid) strict',
    ],
    [
      'volatility drift',
      'alter function private.file_staging_bytes(timestamptz) immutable',
    ],
    [
      'extra config despite retained empty search_path',
      "alter function private.file_parent_staff(text,uuid) set statement_timeout='1s'",
    ],
    [
      'security mode drift',
      'alter function private.file_parent_staff(text,uuid) security invoker',
    ],
    [
      'authenticated grant drift',
      'grant execute on function private.file_parent_staff(text,uuid) to authenticated',
    ],
    [
      'PUBLIC grant drift',
      'grant execute on function private.file_parent_staff(text,uuid) to public',
    ],
  ]) {
    await rejected(note, () => db.query(sql));
  }
  const triggerName = 'inventory_file_storage_completion_guard';
  const table = 'storage.objects';
  const triggerRoutine = 'private.inventory_file_storage_completion_guard()';
  const dropTrigger = `drop trigger ${triggerName} on ${table};`;
  const installTrigger = (timingEvents, extra = '', routine = triggerRoutine) =>
    `create trigger ${triggerName} ${timingEvents} on ${table} for each row ${extra} execute function ${routine};`;
  for (const [note, mutation] of [
    [
      'disabled completion trigger',
      `alter table ${table} disable trigger ${triggerName};`,
    ],
    [
      'replica-only completion trigger',
      `alter table ${table} enable replica trigger ${triggerName};`,
    ],
    [
      'noncanonical always-enabled completion trigger',
      `alter table ${table} enable always trigger ${triggerName};`,
    ],
    [
      'wrong completion routine',
      `set local role postgres;
        create function private.cp5_wrong_completion() returns trigger language plpgsql set search_path='' as $$ begin return new; end $$;
        reset role;
        ${dropTrigger}
        ${installTrigger(
          'before insert or update',
          '',
          'private.cp5_wrong_completion()',
        )}`,
    ],
    [
      'AFTER instead of BEFORE completion',
      `${dropTrigger} ${installTrigger('after insert or update')}`,
    ],
    [
      'INSERT-only completion',
      `${dropTrigger} ${installTrigger('before insert')}`,
    ],
    [
      'UPDATE-only completion',
      `${dropTrigger} ${installTrigger('before update')}`,
    ],
    [
      'column-restricted completion',
      `${dropTrigger} ${installTrigger('before insert or update of metadata')}`,
    ],
    [
      'WHEN false completion',
      `${dropTrigger} ${installTrigger('before insert or update', 'when (false)')}`,
    ],
    [
      'unexpected trigger arguments',
      `${dropTrigger} ${installTrigger(
        'before insert or update',
        '',
        "private.inventory_file_storage_completion_guard('unexpected')",
      )}`,
    ],
    [
      'deferred constraint completion',
      `${dropTrigger} create constraint trigger ${triggerName} after insert or update on ${table} deferrable initially deferred for each row execute function ${triggerRoutine};`,
    ],
  ]) {
    try {
      const observations = localStorageFixture(`${storageObservation('before')}
        reset role;
        ${mutation}
        set local role postgres;
        ${storageObservation('tampered')}`);
      assert.deepEqual(
        observations.map((row) => [row.phase, row.user]),
        [
          ['before', 'postgres'],
          ['tampered', 'postgres'],
        ],
      );
      assert.equal(observations[0].ready, true);
      assert.equal(observations[1].ready, false, note);
      assert.deepEqual(
        observations[1].routines,
        manifest.routines,
        'binding fixture retains every pinned routine definition',
      );
      assert.notDeepEqual(
        observations[1].triggers,
        manifest.triggers,
        'binding fixture changes the actual selected catalog binding',
      );
      checks += 5;
    } finally {
      assert.equal(
        await ready(),
        true,
        'socket fault fixture restores ordinary-caller canonical readiness',
      );
      checks++;
      await fixtureConnectionsClosed();
    }
  }
  for (const [fault, state] of [
    ['select 1/0;', '22012'],
    [
      "set local statement_timeout='100ms'; select pg_catalog.pg_sleep(2);",
      '57014',
    ],
  ]) {
    try {
      assert.throws(
        () => localStorageFixture(`reset role; ${dropTrigger} ${fault}`),
        (error) => error.message.includes(`(${state})`),
      );
      checks++;
    } finally {
      assert.equal(
        await ready(),
        true,
        'failed/timed-out protected DDL rolls back',
      );
      checks++;
      await fixtureConnectionsClosed();
    }
  }
  const socketRejected = async (note, mutation) => {
    try {
      const observations = localStorageFixture(
        `${storageObservation('before')} reset role; ${mutation} set local role postgres; ${storageObservation('tampered')}`,
      );
      assert.equal(observations[0].ready, true);
      assert.equal(observations[1].ready, false, note);
      assert.deepEqual(
        observations[1].routines,
        manifest.routines,
        'Storage wiring/policy fixture leaves pinned functions intact',
      );
      if (mutation.includes('owner to postgres')) {
        const changed = structuredClone(observations[1].storage);
        const relation = mutation.includes('storage.buckets')
          ? changed.buckets
          : changed;
        assert.equal(relation.owner, 'postgres');
        relation.owner = 'supabase_storage_admin';
        assert.deepEqual(
          changed,
          manifest.storage,
          'owner drift preserves all checked RLS, policies and bucket metadata',
        );
        assert.deepEqual(observations[1].triggers, manifest.triggers);
        checks += 3;
      }
      checks += 3;
    } catch (error) {
      throw new Error(`${note}: ${error.message}`);
    } finally {
      assert.equal(
        await ready(),
        true,
        'local Storage fault transaction rolled back',
      );
      checks++;
      await fixtureConnectionsClosed();
    }
  };
  for (const [note, mutation] of [
    [
      'objects owner drift with intact RLS/policies',
      'alter table storage.objects owner to postgres;',
    ],
    ['buckets owner drift', 'alter table storage.buckets owner to postgres;'],
    [
      'buckets RLS disabled',
      'alter table storage.buckets disable row level security;',
    ],
    [
      'buckets forced RLS',
      'alter table storage.buckets force row level security;',
    ],
    [
      'buckets writable authenticated policy',
      'create policy cp5_bucket_update on storage.buckets for update to authenticated using(true) with check(true);',
    ],
    [
      'buckets PUBLIC policy',
      'create policy cp5_bucket_public on storage.buckets for all to public using(true) with check(true);',
    ],
    [
      'missing private bucket',
      "set local storage.allow_delete_query='true'; delete from storage.buckets where id='inventory-files';",
    ],
    [
      'public bucket',
      "update storage.buckets set public=true where id='inventory-files';",
    ],
    [
      'bucket name drift',
      "update storage.buckets set name='cp5-other' where id='inventory-files';",
    ],
    [
      'bucket size drift',
      "update storage.buckets set file_size_limit=20971521 where id='inventory-files';",
    ],
    [
      'bucket size missing',
      "update storage.buckets set file_size_limit=null where id='inventory-files';",
    ],
    ...[
      ['null', 'null'],
      ['missing', "array['image/jpeg','image/png','image/webp']"],
      [
        'extra',
        "array['application/pdf','image/jpeg','image/png','image/webp','text/plain']",
      ],
      [
        'duplicate',
        "array['application/pdf','image/jpeg','image/png','image/webp','image/jpeg']",
      ],
      [
        'null entry',
        "array['application/pdf','image/jpeg','image/png','image/webp',null]",
      ],
    ].map(([fault, value]) => [
      `bucket MIME ${fault}`,
      `update storage.buckets set allowed_mime_types=${value} where id='inventory-files';`,
    ]),
    ['missing completion trigger', dropTrigger],
    [
      'additional AFTER completion mutation trigger',
      `set local role postgres; create function private.cp5_after_completion() returns trigger language plpgsql set search_path='' as $$ begin update storage.objects set metadata='{}'::jsonb where id=new.id; return new; end $$; reset role; create trigger zz_cp5_after_completion after insert on storage.objects for each row execute function private.cp5_after_completion();`,
    ],
    [
      'additional BEFORE trigger ordered after completion guard',
      `set local role postgres; create function private.cp5_late_before() returns trigger language plpgsql set search_path='' as $$ begin new.metadata='{}'::jsonb; return new; end $$; reset role; create trigger zz_cp5_late_before before insert or update on storage.objects for each row execute function private.cp5_late_before();`,
    ],
    [
      'changed provider delete trigger',
      'alter table storage.objects disable trigger protect_objects_delete;',
    ],
    [
      'missing provider update trigger',
      'drop trigger update_objects_updated_at on storage.objects;',
    ],
    [
      'renamed provider trigger changes order',
      'alter trigger update_objects_updated_at on storage.objects rename to aaa_provider_update;',
    ],
    ['RLS disabled', 'alter table storage.objects disable row level security;'],
    [
      'noncanonical forced RLS',
      'alter table storage.objects force row level security;',
    ],
    [
      'unreviewed PUBLIC policy',
      'create policy cp5_public_select on storage.objects for select to public using(true);',
    ],
    [
      'unreviewed authenticated policy',
      'create policy cp5_auth_update on storage.objects for update to authenticated using(true) with check(true);',
    ],
    [
      'changed policy roles',
      'alter policy inventory_file_select on storage.objects to authenticated,anon;',
    ],
    [
      'changed policy PUBLIC role',
      'alter policy inventory_file_select on storage.objects to public;',
    ],
    [
      'permissive USING true',
      'alter policy inventory_file_select on storage.objects using(true);',
    ],
    [
      'permissive CHECK true',
      'alter policy inventory_file_insert on storage.objects with check(true);',
    ],
    [
      'changed policy name',
      'alter policy inventory_file_select on storage.objects rename to cp5_renamed_policy;',
    ],
    [
      'changed policy command',
      'drop policy inventory_file_insert on storage.objects; create policy inventory_file_insert on storage.objects for update to authenticated using(true) with check(private.file_storage_insert(bucket_id,name));',
    ],
    [
      'changed policy mode',
      'drop policy inventory_file_delete on storage.objects; create policy inventory_file_delete on storage.objects as restrictive for delete to authenticated using(private.file_storage_delete(bucket_id,name));',
    ],
    ...manifest.storage.policies.map((policy) => [
      `missing policy ${policy.name}`,
      `drop policy ${policy.name} on storage.objects;`,
    ]),
  ])
    await socketRejected(note, mutation);
  try {
    const observations = localStorageFixture(
      `reset role; update storage.buckets set allowed_mime_types=array['image/webp','application/pdf','image/png','image/jpeg'] where id='inventory-files'; set local role postgres; ${storageObservation('reordered')}`,
    );
    assert.equal(
      observations[0].ready,
      true,
      'MIME ordering is portable while exact membership remains pinned',
    );
    assert.deepEqual(observations[0].storage, manifest.storage);
    checks += 2;
  } finally {
    assert.equal(await ready(), true);
    checks++;
    await fixtureConnectionsClosed();
  }
  const policySql = (policy) =>
    `create policy ${policy.name} on storage.objects as ${policy.permissive ? 'permissive' : 'restrictive'} for ${{ r: 'select', a: 'insert', d: 'delete', '*': 'all', w: 'update' }[policy.command]} to ${policy.roles.join(',')} ${policy.using_expression ? `using(${policy.using_expression})` : ''} ${policy.check_expression ? `with check(${policy.check_expression})` : ''};`;
  // Recreating a canonical policy changes only its local OID.
  try {
    const policy = manifest.storage.policies[0];
    const observation = `select pg_catalog.json_build_object('policy_oid',oid::text) from pg_catalog.pg_policy where polrelid='storage.objects'::pg_catalog.regclass and polname='${policy.name}';`;
    const [before, after, recreated] = localStorageFixture(
      `${observation} reset role; drop policy ${policy.name} on storage.objects; ${policySql(policy)} set local role postgres; ${observation} ${storageObservation('recreated')}`,
    );
    assert.notEqual(before.policy_oid, after.policy_oid);
    assert.equal(recreated.ready, true);
    assert.deepEqual(recreated.storage, manifest.storage);
    checks += 3;
  } finally {
    assert.equal(await ready(), true);
    checks++;
    await fixtureConnectionsClosed();
  }
  // Definition/binding identity is portable: recreating both objects assigns
  // new local OIDs while retaining exactly the reviewed function and trigger.
  try {
    const { definition: sql } = await definition(triggerRoutine);
    const oidObservation = `select pg_catalog.json_build_object('function_oid',tgfoid::text,'trigger_oid',oid::text) from pg_catalog.pg_trigger where tgrelid='storage.objects'::pg_catalog.regclass and tgname='${triggerName}';`;
    const observations = localStorageFixture(`${oidObservation}
      reset role;
      ${dropTrigger}
      set local role postgres;
      drop function ${triggerRoutine};
      ${sql};
      revoke all on function ${triggerRoutine} from public,anon,authenticated,service_role;
      reset role;
      ${installTrigger('before insert or update')}
      set local role postgres;
      ${oidObservation}
      ${storageObservation('recreated')}`);
    const [before, after, recreated] = observations;
    assert.notEqual(before.function_oid, after.function_oid);
    assert.notEqual(before.trigger_oid, after.trigger_oid);
    assert.equal(recreated.user, 'postgres');
    assert.deepEqual(recreated.triggers, manifest.triggers);
    assert.deepEqual(recreated.routines, manifest.routines);
    assert.equal(
      recreated.ready,
      true,
      'canonical binding accepts fresh function/trigger OIDs',
    );
    checks += 6;
  } finally {
    assert.equal(
      await ready(),
      true,
      'fresh-OID fixture restores ordinary-caller canonical readiness',
    );
    checks++;
    await fixtureConnectionsClosed();
  }
  await rejected(
    'unreviewed role EXECUTE despite unchanged effective known-role flags',
    async () => {
      await db.query('create role cp5_unreviewed_execute nologin');
      await db.query(
        'grant execute on function private.file_parent_staff(text,uuid) to cp5_unreviewed_execute',
      );
      const changed = (await catalog()).find(
        (row) => row.signature === 'private.file_parent_staff(text,uuid)',
      );
      assert.equal(changed.authenticated_execute, false);
      assert.equal(changed.anon_execute, false);
      assert.equal(changed.service_execute, false);
      assert.equal(changed.public_execute, false);
      checks += 4;
    },
  );
  await rejected(
    'authenticated EXECUTE grant option is not an ordinary grant',
    () =>
      db.query(
        'grant execute on function public.inventory_file_finalize(uuid,bigint,uuid) to authenticated with grant option',
      ),
  );
  await rejected(
    'routine owner transfer cannot replace reviewed authority',
    async () => {
      await db.query('create role cp5_unreviewed_owner nologin');
      await db.query('grant cp5_unreviewed_owner to postgres with set true');
      await db.query(
        'grant usage,create on schema private to cp5_unreviewed_owner',
      );
      await db.query(
        'alter function private.file_parent_staff(text,uuid) owner to cp5_unreviewed_owner',
      );
    },
  );
  await rejected(
    'unreviewed default EXECUTE grant is captured on recreation',
    async () => {
      const signature = 'private.file_collection_lock(uuid,uuid)';
      const { definition: sql } = await definition(signature);
      await db.query('create role cp5_unreviewed_default nologin');
      await db.query(
        'alter default privileges for role postgres grant execute on functions to cp5_unreviewed_default',
      );
      await db.query(`drop function ${signature}`);
      await db.query(sql);
      await db.query(
        `revoke all on function ${signature} from public,anon,authenticated,service_role`,
      );
    },
  );
  // Same definition and named ACL survive a fresh routine OID. No local OID is
  // learned or embedded in expectations, including owner/grantee/grantor OIDs.
  await db.query('begin');
  try {
    const signature = 'private.file_collection_lock(uuid,uuid)';
    const oldOid = (
      await db.query('select pg_catalog.to_regprocedure($1)::oid oid', [
        signature,
      ])
    ).rows[0].oid;
    const { definition: sql } = await definition(signature);
    await db.query(`drop function ${signature}`);
    await db.query(sql);
    await db.query(
      `revoke all on function ${signature} from public,anon,authenticated,service_role`,
    );
    const newOid = (
      await db.query('select pg_catalog.to_regprocedure($1)::oid oid', [
        signature,
      ])
    ).rows[0].oid;
    assert.notEqual(oldOid, newOid);
    assert.equal(
      await ready(),
      true,
      'portable names and exact body permit fresh routine OID',
    );
    checks += 2;
  } finally {
    await db.query('rollback');
  }
  await rejected('argument default drift without body change', async () => {
    const { definition: sql } = await definition(
      'private.file_signature_valid(text,text,text,boolean)',
    );
    assert.ok(sql.includes('DEFAULT false'));
    await db.query(sql.replace('DEFAULT false', 'DEFAULT true'));
  });
  await rejected('literal whitespace is not normalized away', () =>
    replaceBody('private.file_mac(text,text)', (source) => {
      assert.ok(source.includes("'sha256'"));
      return source.replace("'sha256'", "'sha256 '");
    }),
  );
  await rejected('ordinary trailing body whitespace remains exact', () =>
    replaceBody(
      'private.file_parent_staff(text,uuid)',
      (source) => source + ' ',
    ),
  );
  // PostgreSQL's SQL-standard body lives in prosqlbody rather than prosrc.
  await rejected(
    'SQL-standard body is not accepted as a portable prosrc routine',
    async () => {
      await db.query(
        "create or replace function private.file_mac(p_text text,p_key text) returns text language sql immutable set search_path='' begin atomic select encode(extensions.hmac(convert_to(p_text,'utf8'),convert_to(p_key,'utf8'),'sha256'),'hex'); end",
      );
      assert.equal(
        (
          await db.query(
            "select prosqlbody is not null present from pg_catalog.pg_proc where oid='private.file_mac(text,text)'::regprocedure",
          )
        ).rows[0].present,
        true,
      );
      checks++;
    },
  );
  assert.deepEqual(
    await catalog(),
    manifest.routines,
    'all tamper fixtures restored before subsequent integration work',
  );
  assert.deepEqual(
    await triggers(),
    manifest.triggers,
    'trigger tamper fixtures restored',
  );
  assert.deepEqual(
    await storage(),
    manifest.storage,
    'complete Storage authorization restored',
  );
  checks++;
  checks++;
  await db.query('begin');
  try {
    await replaceBody('private.file_parent_staff(text,uuid)', (source) =>
      source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
    );
    assert.equal(
      await ready(),
      true,
      'only CRLF-to-LF normalization is accepted',
    );
    checks++;
  } finally {
    await db.query('rollback');
  }
  for (const path of [
    '',
    'public',
    'extensions',
    'pg_catalog',
    'public,pg_catalog',
  ]) {
    await db.query('begin');
    try {
      await db.query("select pg_catalog.set_config('search_path',$1,true)", [
        path,
      ]);
      assert.deepEqual(
        await catalog(),
        manifest.routines,
        'catalog metadata remains portable across search_path',
      );
      assert.deepEqual(
        await triggers(),
        manifest.triggers,
        'qualified trigger binding remains portable across search_path',
      );
      assert.deepEqual(
        await storage(),
        manifest.storage,
        'fixed-safe-path policy expressions remain portable across caller search_path',
      );
      assert.equal(
        await ready(),
        true,
        'qualified schema query remains ready across search_path',
      );
      checks += 4;
    } finally {
      await db.query('rollback');
    }
  }
  checks++;
  console.log(
    `Staging routine catalog tamper regression passed (${checks} assertions; ${manifest.routines.length} pinned routines; ${manifest.triggers.length} pinned trigger).`,
  );
}
