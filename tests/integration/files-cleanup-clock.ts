import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

type Outcome = { value?: unknown; code?: string; message?: string };
type Claim = { object_id: string; path: string };

// Runs inside the canonical files integration gate, using authenticated SQL
// callers and independent observed row-lock holders on the disposable backend.
export async function cleanupClockChecks(
  db: Client,
  dbUrl: string,
  actorId: string,
  otherActorId: string,
  parentId: string,
  keyId: string,
  secret: string,
) {
  const target = new URL(dbUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(target.port, '54322');
  let checks = 0;
  const keyBefore = (
    await db.query(
      'select secret,verify_until::text from private.file_keys where key_id=$1',
      [keyId],
    )
  ).rows[0];
  const proof = (
    operation: string,
    args: string[],
    expires = Math.floor(Date.now() / 1000) + 60,
  ) => {
    const nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', secret)
      .update([actorId, operation, ...args, nonce, expires].join(':'))
      .digest('hex');
    return [nonce, expires, signature];
  };
  const claimSql =
    'select public.inventory_file_cleanup_claim_parent($1,$2::uuid,1,$3,$4,$5::bigint,$6) value';
  const claimArgs = (expires?: number) => [
    'asset',
    parentId,
    keyId,
    ...proof('cleanup_claim', ['asset', parentId, '1', keyId], expires),
  ];
  const confirmSql =
    'select public.inventory_file_cleanup_confirm($1::uuid,$2,$3,$4::bigint,$5) value';
  const confirmArgs = (objectId: string, expires?: number) => [
    objectId,
    keyId,
    ...proof('cleanup_confirm', [objectId, keyId], expires),
  ];
  async function caller() {
    const connection = new Client({
      connectionString: dbUrl,
      application_name: 'file-cleanup-clock-caller',
    });
    await connection.connect();
    await connection.query('begin');
    await connection.query("set local statement_timeout='5s'");
    await connection.query('set local role authenticated');
    await connection.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actorId, role: 'authenticated' }),
    ]);
    return connection;
  }
  async function run(sql: string, args: unknown[]) {
    const connection = await caller();
    try {
      const result = await connection.query(sql, args);
      await connection.query('commit');
      return result.rows[0].value;
    } finally {
      await connection.query('rollback').catch(() => undefined);
      await connection.end();
    }
  }
  async function fixture() {
    const id = randomUUID();
    const path = `s/${id}/${randomBytes(16).toString('hex')}`;
    await db.query(
      `insert into public.inventory_files(id,asset_id,uploader_id,original_name,display_title,
       declared_type,declared_bytes,purpose,state,reviewed_collection_revision,source_path,reserve_expires_at)
       values($1,$2,$3,'clock.jpg','clock.jpg','image/jpeg',1,'asset_photo','cancelled',1,$4,clock_timestamp())`,
      [id, parentId, actorId, path],
    );
    const object = await db.query<{ id: string }>(
      "insert into private.file_objects(file_id,variant,path,bytes,cleanup_state) values($1,'source',$2,1,'eligible') returning id",
      [id, path],
    );
    return { id, path, objectId: object.rows[0].id };
  }
  async function finish(objectId: string) {
    const claims = (await run(claimSql, claimArgs())) as Claim[];
    assert.ok(claims.some((entry) => entry.object_id === objectId));
    await run(confirmSql, confirmArgs(objectId));
    checks++;
  }
  async function cutoff(seconds = 0.6) {
    return (
      await db.query<{ cutoff: Date }>(
        "select clock_timestamp()+$1::double precision*interval '1 second' cutoff",
        [seconds],
      )
    ).rows[0].cutoff;
  }
  async function proofCutoff() {
    return (
      await db.query<{ cutoff: Date; expires: string }>(
        'with observed as materialized (select clock_timestamp() at) select to_timestamp(ceil(extract(epoch from at)+0.5)) cutoff,ceil(extract(epoch from at)+0.5)::bigint expires from observed',
      )
    ).rows[0];
  }
  async function blockedCall(
    sql: string,
    args: unknown[],
    options: {
      until?: Date;
      lockSql?: string;
      lockArgs?: unknown[];
      afterObserved?: () => Promise<unknown>;
    } = {},
  ) {
    const holder = new Client({
      connectionString: dbUrl,
      application_name: 'file-cleanup-clock-holder',
    });
    const connection = await caller();
    await holder.connect();
    let waiting: Promise<Outcome> | undefined;
    try {
      await holder.query('begin');
      const holderPid = (
        await holder.query<{ pid: number }>('select pg_backend_pid() pid')
      ).rows[0].pid;
      const callerPid = (
        await connection.query<{ pid: number }>('select pg_backend_pid() pid')
      ).rows[0].pid;
      assert.notEqual(holderPid, callerPid);
      await holder.query(
        options.lockSql ?? 'select id from private.file_guard for update',
        options.lockArgs,
      );
      waiting = connection.query(sql, args).then(
        (result) => ({ value: result.rows[0].value }),
        (error: { code?: string; message?: string }) => ({
          code: error.code,
          message: error.message,
        }),
      );
      const deadline = performance.now() + 1800;
      let observed: { started: Date; at: Date } | undefined;
      while (performance.now() < deadline) {
        const activity = await db.query<{ started: Date; at: Date }>(
          `select xact_start started,clock_timestamp() at from pg_stat_activity where pid=$1 and wait_event_type='Lock'
           and $2::integer=any(pg_blocking_pids(pid))`,
          [callerPid, holderPid],
        );
        if (activity.rows[0]) {
          observed = activity.rows[0];
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.ok(
        observed,
        'the independent caller is observed waiting on the selected row lock',
      );
      checks++;
      const until = options.until ?? new Date(observed.at.getTime() + 300);
      assert.ok(
        observed.started < until,
        'the capability was still live at transaction start',
      );
      await options.afterObserved?.();
      let crossed = false;
      while (performance.now() < deadline) {
        const time = await db.query<{ crossed: boolean }>(
          'select clock_timestamp()>$1::timestamptz crossed',
          [until],
        );
        if (time.rows[0].crossed) {
          crossed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.ok(
        crossed,
        'database wall-clock crossed the cutoff while the caller remained blocked',
      );
      const release = (
        await db.query<{ at: Date }>('select clock_timestamp() at')
      ).rows[0].at;
      await holder.query('commit');
      const result = await waiting;
      if (result.code) await connection.query('rollback');
      else await connection.query('commit');
      return { result, release };
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await waiting?.catch(() => undefined);
      await connection.query('rollback').catch(() => undefined);
      await connection.end();
      await holder.end();
    }
  }
  async function fullLease(objectId: string, release: Date) {
    const duration = (
      await db.query<{ seconds: string }>(
        'select extract(epoch from cleanup_lease_until-$2::timestamptz) seconds from private.file_objects where id=$1',
        [objectId, release],
      )
    ).rows[0];
    assert.ok(
      Number(duration.seconds) >= 120,
      'the full two-minute lease begins after lock release',
    );
    assert.ok(Number(duration.seconds) < 123, 'lease duration remains bounded');
    checks += 2;
  }
  try {
    for (const lock of ['guard', 'parent', 'held-object'] as const) {
      const file = await fixture();
      if (lock === 'held-object') {
        await db.query(
          "update public.inventory_files set state='expired' where id=$1",
          [file.id],
        );
        await db.query(
          "update private.file_objects set cleanup_state='held' where id=$1",
          [file.objectId],
        );
      }
      const options =
        lock === 'parent'
          ? {
              lockSql:
                'select id from public.serialized_assets where id=$1 for update',
              lockArgs: [parentId],
            }
          : lock === 'held-object'
            ? {
                lockSql:
                  'select id from private.file_objects where id=$1 for update',
                lockArgs: [file.objectId],
              }
            : {};
      const { result, release } = await blockedCall(
        claimSql,
        claimArgs(),
        options,
      );
      assert.equal(result.code, undefined);
      assert.deepEqual(result.value, [
        { object_id: file.objectId, path: file.path },
      ]);
      await fullLease(file.objectId, release);
      await finish(file.objectId);
    }
    for (const mode of [
      'reclaim',
      'status-lease',
      'status-grace',
      'confirm',
      'delete',
      'delete-member',
    ] as const) {
      const file = await fixture();
      const until = await cutoff();
      if (mode === 'status-grace') {
        await db.query(
          "update public.inventory_files set validation_lease_until=$2::timestamptz-interval '30 seconds' where id=$1",
          [file.id, until],
        );
      } else {
        await db.query(
          "update private.file_objects set cleanup_state='claimed',cleanup_actor=$2,cleanup_lease_until=$3 where id=$1",
          [
            file.objectId,
            mode.startsWith('status') || mode === 'reclaim'
              ? otherActorId
              : actorId,
            until,
          ],
        );
      }
      const statusSql =
        'select public.inventory_file_cleanup_status($1,$2::uuid) value';
      if (mode.startsWith('status')) {
        assert.deepEqual(await run(statusSql, ['asset', parentId]), {
          outstanding: 1,
          blocked: 1,
        });
      }
      const sql = mode.startsWith('status')
        ? statusSql
        : mode.startsWith('delete')
          ? "select private.file_storage_delete('inventory-files',$1) value"
          : mode === 'confirm'
            ? confirmSql
            : claimSql;
      const args = mode.startsWith('status')
        ? ['asset', parentId]
        : mode.startsWith('delete')
          ? [file.path]
          : mode === 'confirm'
            ? confirmArgs(file.objectId)
            : claimArgs();
      const options =
        mode === 'delete-member'
          ? {
              until,
              lockSql:
                'select user_id from public.app_members where user_id=$1 for update',
              lockArgs: [actorId],
            }
          : { until };
      const { result, release } = await blockedCall(sql, args, options);
      if (mode === 'confirm') {
        assert.equal(result.code, 'P1001');
        assert.equal(result.message, 'forbidden');
      } else {
        assert.equal(result.code, undefined);
        if (mode.startsWith('delete')) assert.equal(result.value, false);
        else if (mode.startsWith('status'))
          assert.deepEqual(result.value, { outstanding: 1, blocked: 0 });
        else {
          assert.deepEqual(result.value, [
            { object_id: file.objectId, path: file.path },
          ]);
          await fullLease(file.objectId, release);
        }
      }
      checks++;
      await finish(file.objectId);
    }
    for (const mode of [
      'claim-proof',
      'confirm-proof',
      'key-proof',
      'key-wait-proof',
      'rotated-mac',
    ] as const) {
      const file = await fixture();
      const expiring = await proofCutoff();
      if (mode === 'confirm-proof') {
        await db.query(
          "update private.file_objects set cleanup_state='claimed',cleanup_actor=$2,cleanup_lease_until=clock_timestamp()+interval '2 minutes' where id=$1",
          [file.objectId, actorId],
        );
      }
      if (mode === 'key-proof')
        await db.query(
          'update private.file_keys set verify_until=$2 where key_id=$1',
          [keyId, expiring.cutoff],
        );
      const args =
        mode === 'confirm-proof'
          ? confirmArgs(file.objectId, Number(expiring.expires))
          : claimArgs(
              mode === 'key-proof' || mode === 'rotated-mac'
                ? undefined
                : Number(expiring.expires),
            );
      const options =
        mode === 'key-wait-proof'
          ? {
              until: expiring.cutoff,
              lockSql:
                'select key_id from private.file_keys where key_id=$1 for update',
              lockArgs: [keyId],
            }
          : {
              until: mode === 'rotated-mac' ? await cutoff() : expiring.cutoff,
              afterObserved:
                mode === 'rotated-mac'
                  ? () =>
                      db.query(
                        'update private.file_keys set secret=$2 where key_id=$1',
                        [keyId, randomBytes(48).toString('hex')],
                      )
                  : undefined,
            };
      const { result } = await blockedCall(
        mode === 'confirm-proof' ? confirmSql : claimSql,
        args,
        options,
      );
      assert.equal(result.code, 'P1001');
      assert.equal(result.message, 'server_proof_required');
      await db.query(
        'update private.file_keys set secret=$2,verify_until=$3 where key_id=$1',
        [keyId, keyBefore.secret, keyBefore.verify_until],
      );
      assert.equal(
        (
          await db.query(
            'select cleanup_state from private.file_objects where id=$1',
            [file.objectId],
          )
        ).rows[0].cleanup_state,
        mode === 'confirm-proof' ? 'claimed' : 'eligible',
      );
      checks += 2;
      await finish(file.objectId);
    }
    return checks;
  } finally {
    await db.query(
      'update private.file_keys set secret=$2,verify_until=$3 where key_id=$1',
      [keyId, keyBefore.secret, keyBefore.verify_until],
    );
  }
}
