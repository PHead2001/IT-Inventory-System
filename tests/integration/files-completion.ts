import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { Client } from 'pg';
import fixture from '../fixtures/auth.json' with { type: 'json' };

function local(value: string | undefined, port: number) {
  assert.ok(value);
  const url = new URL(value);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(Number(url.port), port);
  return value;
}
const url = local(process.env.LOCAL_API_URL, 54321);
const dbUrl = local(process.env.LOCAL_DB_URL, 54322);
const anonKey = process.env.LOCAL_ANON_KEY!;
const adminKey = process.env.LOCAL_SERVICE_ROLE_KEY!;
assert.ok(anonKey && adminKey);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, adminKey, options);
const db = new Client({
  connectionString: dbUrl,
  application_name: 'files-completion-proof',
});
type Actor = { id: string; email: string; client: SupabaseClient };
const people: Actor[] = [];
let assertions = 0;
let reservationKey: { id: string; secret: string };

function hashStringToInt(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}
function proof(
  secret: string,
  actor: string,
  operation: string,
  args: string[],
) {
  const p_nonce = randomBytes(16).toString('hex');
  const p_expires = Math.floor(Date.now() / 1000) + 60;
  return {
    p_nonce,
    p_expires,
    p_mac: createHmac('sha256', secret)
      .update([actor, operation, ...args, p_nonce, p_expires].join(':'))
      .digest('hex'),
  };
}
async function okay(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  assert.equal(error, null, `${name}: ${error?.code} ${error?.message}`);
  assertions++;
  return data;
}
async function actor(): Promise<Actor> {
  const email = `files-completion-${randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: fixture.password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const id = created.data.user.id;
  await db.query(
    "insert into public.app_members(user_id,display_name,role,active) values($1,'Files completion','staff',true)",
    [id],
  );
  const person = await signIn(id, email);
  return person;
}
async function signIn(id: string, email: string): Promise<Actor> {
  const client = createClient(url, anonKey, options);
  const signed = await client.auth.signInWithPassword({
    email,
    password: fixture.password,
  });
  assert.equal(signed.error, null);
  const person = { id, email, client };
  people.push(person);
  return person;
}
async function reserve(
  person: Actor,
  parent: string,
  name: string,
  bytes: number,
  type: 'application/pdf' | 'image/png' = 'application/pdf',
) {
  const revision = await db.query<{ revision: string }>(
    'select revision::text from public.inventory_file_collections where asset_id=$1',
    [parent],
  );
  return (await okay(person.client, 'inventory_file_reserve_ready', {
    p_key_id: reservationKey.id,
    ...proof(reservationKey.secret, person.id, 'reserve', [
      'asset',
      parent,
      revision.rows[0]?.revision ?? '1',
      Buffer.from(name).toString('hex'),
      type,
      String(bytes),
      '-',
      '-',
      reservationKey.id,
    ]),
    p_parent_type: 'asset',
    p_parent_id: parent,
    p_expected_revision: revision.rows[0]?.revision ?? '1',
    p_name: name,
    p_type: type,
    p_bytes: bytes,
    p_replaces: null,
    p_expected_file_version: null,
  })) as { id: string; path: string };
}
async function waitForProviderWait(holderPid: number, count: number) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const result = await db.query<{ pid: number }>(
      `select a.pid from pg_stat_activity a
       where a.wait_event_type='Lock'
         and a.query ilike '%pg_advisory_xact_lock%'
         and $1::integer=any(pg_blocking_pids(a.pid))`,
      [holderPid],
    );
    if (result.rows.length >= count) {
      assertions++;
      return result.rows.map((row) => row.pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Storage completion did not reach observed advisory wait (${count})`,
  );
}
async function waitForBarrierWait(barrierPid: number, holderPid: number) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const result = await db.query<{ waiting: boolean }>(
      `select exists(select 1 from pg_stat_activity a where a.pid=$1
       and a.wait_event_type='Lock' and $2::integer=any(pg_blocking_pids(a.pid))) waiting`,
      [barrierPid, holderPid],
    );
    if (result.rows[0].waiting) {
      assertions++;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Intermediate SQL lock did not enter the observed queue');
}
async function waitForBlocked(holderPid: number, waiterPid: number) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const result = await db.query<{ blocked: boolean }>(
      `select exists(select 1 from pg_stat_activity a where a.pid=$2
       and a.wait_event_type='Lock' and $1::integer=any(pg_blocking_pids(a.pid))) blocked`,
      [holderPid, waiterPid],
    );
    if (result.rows[0].blocked) {
      assertions++;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Storage completion did not reach the held key row');
}
async function holder(path: string) {
  const connection = new Client({
    connectionString: dbUrl,
    application_name: 'files-completion-holder',
  });
  await connection.connect();
  const key = hashStringToInt(`inventory-files/${path}`);
  const result = await connection.query<{ pid: number }>(
    'select pg_backend_pid() pid,pg_advisory_lock($1::bigint)',
    [key],
  );
  const pid = result.rows[0].pid;
  return {
    key,
    pid,
    connection,
    async release() {
      await connection.query('select pg_advisory_unlock($1::bigint)', [key]);
    },
  };
}
async function cleanup(
  person: Actor,
  file: { id: string; path: string },
  keyId: string,
  secret: string,
) {
  const state = await db.query<{
    state: string;
    version: string;
    revision: string;
  }>(
    `select f.state,f.version::text,c.revision::text from public.inventory_files f
      join public.inventory_file_collections c on c.asset_id is not distinct from f.asset_id
        and c.quantity_id is not distinct from f.quantity_id where f.id=$1`,
    [file.id],
  );
  if (['reserved', 'uploaded', 'validated'].includes(state.rows[0].state)) {
    await okay(person.client, 'inventory_file_cancel', { p_file_id: file.id });
  } else if (state.rows[0].state === 'ready') {
    await okay(person.client, 'inventory_file_remove', {
      p_file_id: file.id,
      p_expected_revision: state.rows[0].revision,
      p_expected_file_version: state.rows[0].version,
      p_request_id: randomUUID(),
    });
  }
  const expectedPaths = await db.query<{ path: string }>(
    "select path from private.file_objects where file_id=$1 and cleanup_state='eligible' order by path",
    [file.id],
  );
  const claims = (await okay(
    person.client,
    'inventory_file_cleanup_claim_parent',
    {
      p_parent_type: 'asset',
      p_parent_id: (
        await db.query(
          'select asset_id from public.inventory_files where id=$1',
          [file.id],
        )
      ).rows[0].asset_id,
      p_limit: 4,
      p_key_id: keyId,
      ...proof(secret, person.id, 'cleanup_claim', [
        'asset',
        (
          await db.query(
            'select asset_id from public.inventory_files where id=$1',
            [file.id],
          )
        ).rows[0].asset_id,
        '4',
        keyId,
      ]),
    },
  )) as { path: string; object_id: string }[];
  assert.deepEqual(
    claims.map((claim) => claim.path).sort(),
    expectedPaths.rows.map((row) => row.path),
  );
  assertions++;
  for (const claim of claims) {
    const present = await db.query<{ present: boolean }>(
      "select exists(select 1 from storage.objects where bucket_id='inventory-files' and name=$1) present",
      [claim.path],
    );
    if (present.rows[0].present) {
      const deleted = await person.client.storage
        .from('inventory-files')
        .remove([claim.path]);
      assert.equal(deleted.error, null);
      assertions++;
    }
    await okay(person.client, 'inventory_file_cleanup_confirm', {
      p_object_id: claim.object_id,
      p_key_id: keyId,
      ...proof(secret, person.id, 'cleanup_confirm', [claim.object_id, keyId]),
    });
  }
}

async function main() {
  await db.connect();
  const keyId = 'completion' + randomBytes(5).toString('hex');
  const secret = randomBytes(48).toString('hex');
  reservationKey = { id: keyId, secret };
  await db.query(
    "insert into private.file_keys(key_id,secret,accepts_new,verify_until) values($1,$2,true,now()+interval '2 hours')",
    [keyId, secret],
  );
  try {
    const staff = await actor();
    const independent = await signIn(staff.id, staff.email);
    const reference = await db.query<{
      category_id: string;
      location_id: string;
    }>(
      `select (select id from public.categories limit 1) category_id,
       (select id from public.locations where active and can_hold_inventory limit 1) location_id`,
    );
    const created = await okay(staff.client, 'asset_create', {
      p_request_id: randomUUID(),
      p_payload: {
        name: `Files completion ${randomUUID()}`,
        description: null,
        category_id: reference.rows[0].category_id,
        manufacturer: null,
        model: null,
        asset_tag: null,
        serial_number: null,
        location_id: reference.rows[0].location_id,
      },
    });
    const parent = created.entity_id as string;
    const firstPdf = await PDFDocument.create();
    firstPdf.addPage([200, 200]);
    const bytesA = Buffer.from(await firstPdf.save());
    const secondPdf = await PDFDocument.create();
    secondPdf.addPage([300, 300]);
    const bytesB = Buffer.from(await secondPdf.save());

    // Both Storage requests finish their body and queue on Storage's own
    // completion advisory lock, proving that RLS preflight has passed.
    const duplicate = await reserve(
      staff,
      parent,
      'duplicate.pdf',
      bytesA.length,
    );
    const first = await holder(duplicate.path);
    const barrier = new Client({
      connectionString: dbUrl,
      application_name: 'files-completion-middle',
    });
    await barrier.connect();
    let barrierHeld = false;
    let firstReleased = false;
    let middleRequest: Promise<unknown> | undefined;
    let uploadA: Promise<unknown> | undefined;
    let uploadB: Promise<unknown> | undefined;
    try {
      uploadA = staff.client.storage
        .from('inventory-files')
        .upload(duplicate.path, bytesA, {
          contentType: 'application/pdf',
        });
      await waitForProviderWait(first.pid, 1);
      const barrierPid = (
        await barrier.query<{ pid: number }>('select pg_backend_pid() pid')
      ).rows[0].pid;
      middleRequest = barrier.query('select pg_advisory_lock($1::bigint)', [
        first.key,
      ]);
      await waitForBarrierWait(barrierPid, first.pid);
      uploadB = independent.client.storage
        .from('inventory-files')
        .upload(
          duplicate.path,
          new Blob([bytesB], { type: 'application/pdf' }),
          { contentType: 'application/pdf' },
        );
      await waitForProviderWait(first.pid, 2);
      await first.release();
      firstReleased = true;
      const resultA = await uploadA;
      assert.equal((resultA as { error: Error | null }).error, null);
      await middleRequest;
      barrierHeld = true;
      await okay(staff.client, 'inventory_file_uploaded', {
        p_file_id: duplicate.id,
      });
      const requestId = randomUUID();
      const begin = (await okay(staff.client, 'inventory_file_begin', {
        p_file_id: duplicate.id,
        p_request_id: requestId,
        p_key_id: keyId,
        ...proof(secret, staff.id, 'begin', [duplicate.id, requestId, keyId]),
      })) as {
        generation: number;
        lease_until: number;
        source_id: string;
        source_version: string;
      };
      const digest = createHash('sha256').update(bytesA).digest('hex');
      const attestation = [
        'v2',
        staff.id,
        duplicate.id,
        begin.generation,
        'asset',
        parent,
        1,
        requestId,
        begin.lease_until,
        keyId,
        'asset_document',
        '-',
        '-',
        begin.source_id,
        begin.source_version,
        'application/pdf',
        bytesA.length,
        digest,
        '',
      ].join(':');
      await okay(staff.client, 'inventory_file_validated', {
        p_file_id: duplicate.id,
        p_generation: begin.generation,
        p_key_id: keyId,
        p_source_id: begin.source_id,
        p_source_version: begin.source_version,
        p_type: 'application/pdf',
        p_bytes: bytesA.length,
        p_sha256: digest,
        p_mac: createHmac('sha256', secret).update(attestation).digest('hex'),
      });
      await okay(staff.client, 'inventory_file_finalize', {
        p_file_id: duplicate.id,
        p_expected_revision: 1,
        p_request_id: requestId,
      });
      const live = await okay(staff.client, 'inventory_file_read', {
        p_file_id: duplicate.id,
        p_variant: 'source',
      });
      assert.equal(live, duplicate.path);
      const before = await db.query<{
        id: string;
        version: string;
        metadata: unknown;
      }>(
        "select id,version,metadata from storage.objects where bucket_id='inventory-files' and name=$1",
        [duplicate.path],
      );
      await barrier.query('select pg_advisory_unlock($1::bigint)', [first.key]);
      barrierHeld = false;
      const resultB = (await uploadB) as { error: Error | null };
      assert.ok(
        resultB.error,
        'second completion must not overwrite uploaded path',
      );
      const after = await db.query<{
        id: string;
        version: string;
        metadata: unknown;
      }>(
        "select id,version,metadata from storage.objects where bucket_id='inventory-files' and name=$1",
        [duplicate.path],
      );
      assert.deepEqual(after.rows[0], before.rows[0]);
      const downloaded = await staff.client.storage
        .from('inventory-files')
        .download(duplicate.path);
      assert.equal(downloaded.error, null);
      assert.deepEqual(
        Buffer.from(await downloaded.data!.arrayBuffer()),
        bytesA,
      );
      const info = await staff.client.storage
        .from('inventory-files')
        .info(duplicate.path);
      assert.equal(info.error, null, 'ordinary Storage info stays available');
      const assertSealedSource = async () => {
        const current = await db.query<{
          id: string;
          version: string;
          metadata: unknown;
        }>(
          "select id,version,metadata from storage.objects where bucket_id='inventory-files' and name=$1",
          [duplicate.path],
        );
        assert.deepEqual(
          current.rows[0],
          before.rows[0],
          'denied Storage operation preserves sealed source identity',
        );
        const bytes = await staff.client.storage
          .from('inventory-files')
          .download(duplicate.path);
        assert.equal(bytes.error, null);
        assert.deepEqual(
          Buffer.from(await bytes.data!.arrayBuffer()),
          bytesA,
          'denied Storage operation preserves sealed PDF bytes',
        );
        assertions += 2;
      };
      const upsert = await staff.client.storage
        .from('inventory-files')
        .upload(
          duplicate.path,
          new Blob([bytesB], { type: 'application/pdf' }),
          { contentType: 'application/pdf', upsert: true },
        );
      assert.ok(upsert.error, 'sealed ready PDF cannot be upserted');
      assert.equal(upsert.error.statusCode, '403');
      await assertSealedSource();
      const copyTarget = `s/${randomUUID()}/${randomBytes(16).toString('hex')}`;
      const copied = await staff.client.storage
        .from('inventory-files')
        .copy(duplicate.path, copyTarget);
      assert.ok(
        copied.error,
        'sealed PDF cannot be copied to an unregistered path',
      );
      assert.ok(
        ['401', '403', '404'].includes(copied.error.statusCode ?? ''),
        'copy denial is a mapped authorization or absence response',
      );
      await assertSealedSource();
      const moveTarget = `s/${randomUUID()}/${randomBytes(16).toString('hex')}`;
      const moved = await staff.client.storage
        .from('inventory-files')
        .move(duplicate.path, moveTarget);
      assert.ok(
        moved.error,
        'sealed PDF cannot be moved to an unregistered path',
      );
      assert.ok(
        ['401', '403', '404'].includes(moved.error.statusCode ?? ''),
        'move denial is a mapped authorization or absence response',
      );
      await assertSealedSource();
      const targets = await db.query<{ count: string }>(
        "select count(*) from storage.objects where bucket_id='inventory-files' and name=any($1::text[])",
        [[copyTarget, moveTarget]],
      );
      assert.equal(targets.rows[0].count, '0');
      assertions += 7;
      await db.query(
        "update storage.objects set last_accessed_at=clock_timestamp() where bucket_id='inventory-files' and name=$1",
        [duplicate.path],
      );
      await assert.rejects(
        db.query(
          "update storage.objects set version=$2 where bucket_id='inventory-files' and name=$1",
          [duplicate.path, randomUUID()],
        ),
        { code: '42501' },
      );
      await assert.rejects(
        db.query(
          "update storage.objects set metadata=jsonb_set(metadata,'{size}','999'::jsonb) where bucket_id='inventory-files' and name=$1",
          [duplicate.path],
        ),
        { code: '42501' },
      );
      assertions += 10;
    } finally {
      if (!firstReleased) await first.release();
      if (middleRequest) await middleRequest.catch(() => undefined);
      if (barrierHeld)
        await barrier.query('select pg_advisory_unlock($1::bigint)', [
          first.key,
        ]);
      if (uploadB) await uploadB.catch(() => undefined);
      await barrier.end();
      await first.connection.end();
    }
    await cleanup(staff, duplicate, keyId, secret);

    // Cancellation and exact cleanup complete while Storage is paused after
    // preflight. Its later privileged INSERT cannot resurrect the tombstone.
    const cancelled = await reserve(staff, parent, 'late.pdf', bytesA.length);
    const second = await holder(cancelled.path);
    let secondReleased = false;
    try {
      const lateUpload = staff.client.storage
        .from('inventory-files')
        .upload(cancelled.path, bytesA, { contentType: 'application/pdf' });
      await waitForProviderWait(second.pid, 1);
      await cleanup(staff, cancelled, keyId, secret);
      await second.release();
      secondReleased = true;
      const result = await lateUpload;
      assert.ok(
        result.error,
        'late Storage completion must fail after cleanup',
      );
      const state = await db.query<{
        state: string;
        cleanup_state: string;
        object_count: string;
      }>(
        `select f.state,o.cleanup_state,
           (select count(*) from storage.objects so where so.bucket_id='inventory-files' and so.name=o.path) object_count
         from public.inventory_files f join private.file_objects o on o.file_id=f.id
         where f.id=$1`,
        [cancelled.id],
      );
      assert.deepEqual(state.rows[0], {
        state: 'cancelled',
        cleanup_state: 'deleted',
        object_count: '0',
      });
      assertions += 2;
    } finally {
      if (!secondReleased) await second.release();
      await second.connection.end();
    }

    // A prepared derived image has passed Storage preflight and streamed its
    // body. A real validation rejection then invalidates that generation
    // before the privileged completion INSERT can run.
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#1267aa' },
    })
      .png()
      .toBuffer();
    const image = await reserve(
      staff,
      parent,
      'late.png',
      png.length,
      'image/png',
    );
    const sourceUpload = await staff.client.storage
      .from('inventory-files')
      .upload(image.path, png, { contentType: 'image/png' });
    assert.equal(sourceUpload.error, null);
    await okay(staff.client, 'inventory_file_uploaded', {
      p_file_id: image.id,
    });
    const imageRequest = randomUUID();
    const imageBegin = (await okay(staff.client, 'inventory_file_begin', {
      p_file_id: image.id,
      p_request_id: imageRequest,
      p_key_id: keyId,
      ...proof(secret, staff.id, 'begin', [image.id, imageRequest, keyId]),
    })) as { generation: number; lease_until: number };
    const nonce = randomBytes(16).toString('hex');
    const expires = imageBegin.lease_until - 1;
    const capability = [
      staff.id,
      image.id,
      imageBegin.generation,
      'display',
      nonce,
      expires,
    ].join(':');
    const path = `d/${keyId}/${image.id}/${imageBegin.generation}/display/${nonce}/${expires}/${createHmac('sha256', secret).update(capability).digest('hex')}`;
    const digest = createHash('sha256').update(png).digest('hex');
    await okay(staff.client, 'inventory_file_prepare_variant', {
      p_file_id: image.id,
      p_generation: imageBegin.generation,
      p_variant: 'display',
      p_path: path,
      p_bytes: png.length,
      p_sha256: digest,
      p_mac: createHmac('sha256', secret)
        .update(
          [
            staff.id,
            image.id,
            imageBegin.generation,
            'display',
            path,
            png.length,
            digest,
          ].join(':'),
        )
        .digest('hex'),
    });
    const provider = await holder(path);
    let providerReleased = false;
    const keyHolder = new Client({
      connectionString: dbUrl,
      application_name: 'files-completion-key-holder',
    });
    await keyHolder.connect();
    let keyTransaction = false;
    let expiringUpload: Promise<unknown> | undefined;
    try {
      expiringUpload = staff.client.storage
        .from('inventory-files')
        .upload(path, png, { contentType: 'image/png' });
      const [providerPid] = await waitForProviderWait(provider.pid, 1);
      await keyHolder.query('begin');
      keyTransaction = true;
      const keyPid = (
        await keyHolder.query<{ pid: number }>(
          'select pg_backend_pid() pid from private.file_keys where key_id=$1 for update',
          [keyId],
        )
      ).rows[0].pid;
      await provider.release();
      providerReleased = true;
      await waitForBlocked(keyPid, providerPid);
      await keyHolder.query(
        "update private.file_keys set verify_until=clock_timestamp()+interval '400 milliseconds' where key_id=$1",
        [keyId],
      );
      const expiryDeadline = performance.now() + 1200;
      while (performance.now() < expiryDeadline) {
        const expired = await keyHolder.query<{ expired: boolean }>(
          'select clock_timestamp()>=verify_until expired from private.file_keys where key_id=$1',
          [keyId],
        );
        if (expired.rows[0].expired) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const expired = await keyHolder.query<{ expired: boolean }>(
        'select clock_timestamp()>=verify_until expired from private.file_keys where key_id=$1',
        [keyId],
      );
      assert.equal(expired.rows[0].expired, true);
      await keyHolder.query('commit');
      keyTransaction = false;
      const result = (await expiringUpload) as { error: Error | null };
      assert.ok(
        result.error,
        'completion waiting across natural key expiry fails',
      );
      assert.equal(
        (result.error as { statusCode?: string }).statusCode,
        '403',
        'late expiry is authorization failure, not a lock timeout',
      );
      const absent = await db.query<{ count: string }>(
        "select count(*) from storage.objects where bucket_id='inventory-files' and name=$1",
        [path],
      );
      assert.equal(absent.rows[0].count, '0');
      assertions += 4;
    } finally {
      if (!providerReleased) await provider.release();
      if (keyTransaction) await keyHolder.query('rollback');
      if (expiringUpload) await expiringUpload.catch(() => undefined);
      await keyHolder.end();
      await provider.connection.end();
      // Restore only this disposable local fixture key so its subsequent
      // rejection and cleanup can use the normal signed RPCs.
      await db.query(
        "update private.file_keys set verify_until=clock_timestamp()+interval '2 hours' where key_id=$1",
        [keyId],
      );
    }
    const third = await holder(path);
    let thirdReleased = false;
    let derivedUpload: Promise<unknown> | undefined;
    try {
      derivedUpload = staff.client.storage
        .from('inventory-files')
        .upload(path, png, { contentType: 'image/png' });
      await waitForProviderWait(third.pid, 1);
      await okay(staff.client, 'inventory_file_reject', {
        p_file_id: image.id,
        p_generation: imageBegin.generation,
        p_key_id: keyId,
        ...proof(secret, staff.id, 'reject', [
          image.id,
          imageBegin.generation.toString(),
          keyId,
        ]),
      });
      await third.release();
      thirdReleased = true;
      const result = (await derivedUpload) as { error: Error | null };
      assert.ok(
        result.error,
        'rejected generation cannot complete derived upload',
      );
      const object = await db.query<{ count: string }>(
        "select count(*) from storage.objects where bucket_id='inventory-files' and name=$1",
        [path],
      );
      assert.equal(object.rows[0].count, '0');
      assertions += 3;
    } finally {
      if (!thirdReleased) await third.release();
      if (derivedUpload) await derivedUpload.catch(() => undefined);
      await third.connection.end();
    }
    // The production cleanup worker observes a 30-second grace after a
    // validation attempt. Advance only this fictional fixture's expired
    // lease after the completion race so the focused test can clean it now.
    await db.query(
      "update public.inventory_files set validation_lease_until=clock_timestamp()-interval '31 seconds' where id=$1 and state='rejected'",
      [image.id],
    );
    await cleanup(staff, image, keyId, secret);

    const expiredSource = await reserve(
      staff,
      parent,
      'expired-source.pdf',
      bytesA.length,
    );
    await db.query(
      "update public.inventory_files set reserve_expires_at=clock_timestamp()-interval '1 second' where id=$1 and state='reserved'",
      [expiredSource.id],
    );
    const expiredUpload = await staff.client.storage
      .from('inventory-files')
      .upload(
        expiredSource.path,
        new Blob([bytesA], { type: 'application/pdf' }),
        { contentType: 'application/pdf' },
      );
    assert.ok(
      expiredUpload.error,
      'expired source reservation cannot complete',
    );
    assert.equal(expiredUpload.error.statusCode, '403');
    const expiredObject = await db.query<{ count: string }>(
      "select count(*) from storage.objects where bucket_id='inventory-files' and name=$1",
      [expiredSource.path],
    );
    assert.equal(expiredObject.rows[0].count, '0');
    assertions += 3;
    await cleanup(staff, expiredSource, keyId, secret);

    await assert.rejects(
      db.query(
        `insert into storage.objects(bucket_id,name,owner,owner_id,metadata,version)
         values('inventory-files',$1,$2,$3,'{}'::jsonb,'1')`,
        [
          `s/${randomUUID()}/${randomBytes(16).toString('hex')}`,
          staff.id,
          staff.id,
        ],
      ),
      { code: '42501' },
    );
    assertions++;
    const deniedPath = `s/${randomUUID()}/${randomBytes(16).toString('hex')}`;
    const deniedUpload = await staff.client.storage
      .from('inventory-files')
      .upload(deniedPath, bytesA, { contentType: 'application/pdf' });
    assert.ok(deniedUpload.error, 'unregistered Storage path is denied');
    assert.equal(deniedUpload.error?.statusCode, '403');
    const deniedObject = await db.query<{ count: string }>(
      "select count(*) from storage.objects where bucket_id='inventory-files' and name=$1",
      [deniedPath],
    );
    assert.equal(deniedObject.rows[0].count, '0');
    assertions += 3;
    console.log(
      `File completion guard passed (${assertions} checks; observed post-preflight barriers).`,
    );
  } finally {
    await db.query(
      'update private.file_keys set accepts_new=false,verify_until=now(),secret=$2 where key_id=$1',
      [keyId, randomBytes(48).toString('hex')],
    );
    await Promise.allSettled(
      people.map((person) => person.client.auth.signOut({ scope: 'local' })),
    );
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
