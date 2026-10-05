// Disposable loopback catalog regression, called by the canonical DB gate.
// Every mutation is rolled back, including when an assertion fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import manifest from '../../scripts/staging-file-routines.json' with { type: 'json' };
import { STAGING_SCHEMA_SQL } from '../../scripts/staging-file-keys-providers.mjs';
import { STAGING_ROUTINE_CATALOG_SQL } from '../../scripts/staging-file-routines.mjs';

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
export async function verifyStagingRoutineContract(db) {
  let checks = 0;
  const ready = async () => (await db.query(STAGING_SCHEMA_SQL)).rows[0].ready;
  const catalog = async () =>
    (await db.query(STAGING_ROUTINE_CATALOG_SQL)).rows.map(
      (row) => row.routine,
    );
  assert.deepEqual(
    await catalog(),
    manifest.routines,
    'fresh canonical catalog must match checked-in manifest',
  );
  assert.equal(await ready(), true, 'canonical schema ready');
  checks += 2;
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
      assert.equal(
        await ready(),
        true,
        'qualified schema query remains ready across search_path',
      );
      checks += 2;
    } finally {
      await db.query('rollback');
    }
  }
  checks++;
  console.log(
    `Staging routine catalog tamper regression passed (${checks} assertions; ${manifest.routines.length} pinned routines).`,
  );
}
