import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Worker } from 'node:worker_threads';
import authFixture from '../fixtures/auth.json' with { type: 'json' };
import { cleanupClockChecks } from './files-cleanup-clock';

function local(value: string | undefined, port: number) {
  assert.ok(value);
  const url = new URL(value);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(Number(url.port), port);
  return value;
}
const url = local(process.env.LOCAL_API_URL, 45321);
const dbUrl = local(process.env.LOCAL_DB_URL, 45322);
const anonKey = process.env.LOCAL_ANON_KEY!;
const adminKey = process.env.LOCAL_SERVICE_ROLE_KEY!;
assert.ok(anonKey && adminKey);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, adminKey, options);
const anonymous = createClient(url, anonKey, options);
const db = new Client({
  connectionString: dbUrl,
  application_name: 'files-integration',
});
type Actor = { id: string; email: string; client: SupabaseClient };
const actors: Actor[] = [];
let keyToRetire: string | undefined;
let keySecretForCleanup: string | undefined;
let mainFailed = false;
const sha = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
const mac = (key: string, data: string) =>
  createHmac('sha256', key).update(data).digest('hex');
function serverProof(
  secret: string,
  actorId: string,
  operation: string,
  args: string[],
) {
  const p_nonce = randomBytes(16).toString('hex');
  const p_expires = Math.floor(Date.now() / 1000) + 60;
  return {
    p_nonce,
    p_expires,
    p_mac: mac(
      secret,
      [actorId, operation, ...args, p_nonce, p_expires].join(':'),
    ),
  };
}
let checks = 0;
function eq<T>(actual: T, expected: T, note: string) {
  assert.deepEqual(actual, expected, note);
  checks++;
}
async function actor(role: 'staff' | 'viewer'): Promise<Actor> {
  const email = `files-${role}-${randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  const id = created.data.user.id;
  await db.query(
    'insert into public.app_members(user_id,display_name,role,active) values($1,$2,$3,true)',
    [id, `Files ${role}`, role],
  );
  const client = createClient(url, anonKey, options);
  const login = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  assert.ifError(login.error);
  const signedIn = { id, email, client };
  actors.push(signedIn);
  return signedIn;
}
async function independentSession(person: Actor) {
  const client = createClient(url, anonKey, options);
  const login = await client.auth.signInWithPassword({
    email: person.email,
    password: authFixture.password,
  });
  assert.ifError(login.error);
  actors.push({ id: person.id, email: person.email, client });
  return client;
}
async function raceStorageUploadWithCancel(
  person: Actor,
  path: string,
  fileId: string,
) {
  // Keep the deliberately rejectable upload on its own bounded connection
  // while preserving the race and subsequent 20 MiB upload assertions.
  const child = fork(new URL('./files-race-upload.mjs', import.meta.url), [], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      LOCAL_API_URL: url,
      LOCAL_ANON_KEY: anonKey,
    },
  });
  try {
    return await new Promise<{
      uploadOutcome: { error: { message: string } | null };
      cancelOutcome: Awaited<ReturnType<typeof rpc>>;
    }>((resolve, reject) => {
      let finished = false;
      let cancelPromise: ReturnType<typeof rpc> | undefined;
      const deadline = setTimeout(
        () =>
          finish(new Error('Storage upload/cancel race exceeded 30 seconds')),
        30_000,
      );
      function finish(
        error?: Error,
        result?: {
          uploadOutcome: { error: { message: string } | null };
          cancelOutcome: Awaited<ReturnType<typeof rpc>>;
        },
      ) {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (error) reject(error);
        else resolve(result!);
      }
      child.on('error', (error) => finish(error));
      child.on('exit', (code) => {
        if (!finished)
          finish(new Error(`Storage race helper exited early (${code})`));
      });
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object' || !('type' in message))
          return finish(new Error('Storage race helper sent invalid message'));
        if (message.type === 'ready') child.send({ type: 'go' });
        else if (message.type === 'started') {
          cancelPromise = rpc(person.client, 'inventory_file_cancel', {
            p_file_id: fileId,
          });
          void cancelPromise.catch((error) => finish(error));
        } else if (message.type === 'result') {
          if (!cancelPromise || !('error' in message))
            return finish(
              new Error('Storage race helper result was incomplete'),
            );
          void cancelPromise.then(
            (cancelOutcome) =>
              finish(undefined, {
                uploadOutcome: {
                  error: message.error
                    ? { message: String(message.error) }
                    : null,
                },
                cancelOutcome,
              }),
            (error) => finish(error),
          );
        } else if (message.type === 'failure') {
          finish(new Error('Storage race helper failed'));
        }
      });
      child.send({ type: 'prepare', email: person.email, path });
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null)
        return resolve();
      let forced = false;
      const deadline = setTimeout(() => {
        forced = true;
        child.kill();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(deadline);
        if (forced)
          reject(
            new Error('Storage race helper did not drain before shutdown'),
          );
        else resolve();
      });
      if (child.connected) child.send({ type: 'shutdown' });
      else child.kill();
    });
  }
}
async function cleanupWithLostConfirmation(
  person: Actor,
  parentId: string,
  keyId: string,
  secret: string,
) {
  const child = fork(
    new URL('./files-cleanup-response-loss.ts', import.meta.url),
    [],
    {
      execArgv: ['--conditions=react-server', '--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { NODE_ENV: 'test', LOCAL_API_URL: url, LOCAL_ANON_KEY: anonKey },
    },
  );
  return new Promise<{
    result: {
      status: string;
      deleted: number;
      failed: number;
      outstanding: number;
      blocked: number;
      pending: boolean;
    };
    committed: number;
  }>((resolve, reject) => {
    let result:
      | {
          result: {
            status: string;
            deleted: number;
            failed: number;
            outstanding: number;
            blocked: number;
            pending: boolean;
          };
          committed: number;
        }
      | undefined;
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('Cleanup response-loss helper exceeded 30 seconds'));
    }, 30000);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on('message', (message: typeof result & { failure?: boolean }) => {
      if (!message || message.failure) return;
      result = message;
    });
    child.once('exit', (code) => {
      clearTimeout(deadline);
      if (code !== 0 || !result)
        reject(new Error('Cleanup response-loss helper failed'));
      else resolve(result);
    });
    child.send({
      email: person.email,
      actorId: person.id,
      parentId,
      keyId,
      secret,
    });
  });
}
async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const person = actors.find((entry) => entry.client === client);
  // These local-only fixtures exercise the server's signed dispatch contract.
  // Direct unsigned callers are tested separately below.
  if (
    name === 'inventory_file_reserve' &&
    person &&
    keyToRetire &&
    keySecretForCleanup
  ) {
    return client.rpc('inventory_file_reserve_ready', {
      ...args,
      p_replaces: args.p_replaces ?? null,
      p_expected_file_version: args.p_expected_file_version ?? null,
      p_key_id: keyToRetire,
      ...serverProof(keySecretForCleanup, person.id, 'reserve', [
        String(args.p_parent_type),
        String(args.p_parent_id),
        String(args.p_expected_revision),
        Buffer.from(String(args.p_name)).toString('hex'),
        String(args.p_type),
        String(args.p_bytes),
        String(args.p_replaces ?? '-'),
        String(args.p_expected_file_version ?? '-'),
        keyToRetire,
      ]),
    });
  }
  if (
    name === 'inventory_file_cleanup_claim' &&
    person &&
    keySecretForCleanup
  ) {
    const parents = await db.query<{ kind: string; id: string }>(
      "select distinct case when asset_id is null then 'quantity' else 'asset' end kind,coalesce(asset_id,quantity_id) id from public.inventory_files where uploader_id=$1 order by id",
      [person.id],
    );
    const claims: { object_id: string; path: string }[] = [];
    for (const parent of parents.rows) {
      const result = await client.rpc('inventory_file_cleanup_claim_parent', {
        ...args,
        p_parent_type: parent.kind,
        p_parent_id: parent.id,
        ...serverProof(keySecretForCleanup, person.id, 'cleanup_claim', [
          parent.kind,
          parent.id,
          String(args.p_limit),
          String(args.p_key_id),
        ]),
      });
      if (result.error) return result;
      claims.push(...result.data);
    }
    return { data: claims, error: null };
  }
  return client.rpc(name, args);
}
async function okay(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await rpc(client, name, args);
  assert.equal(
    result.error,
    null,
    `${name}: ${result.error?.code} ${result.error?.message}`,
  );
  checks++;
  return result.data;
}
async function denied(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  code?: string,
) {
  const result = await rpc(client, name, args);
  assert.ok(result.error, `${name} should fail`);
  if (code) eq(result.error.code, code, `${name} error code`);
  checks++;
}
async function asset(staff: Actor, category: string, location: string) {
  const result = await okay(staff.client, 'asset_create', {
    p_request_id: randomUUID(),
    p_payload: {
      name: 'File test ' + randomUUID(),
      description: null,
      category_id: category,
      manufacturer: null,
      model: null,
      asset_tag: null,
      serial_number: null,
      location_id: location,
    },
  });
  return result.entity_id as string;
}
function pngBytes(color: number) {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color;
    png.data[i + 1] = 60;
    png.data[i + 2] = 120;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
async function inspect(bytes: Uint8Array, type: string) {
  return new Promise<{
    ok: boolean;
    variants?: Uint8Array[];
    message?: string;
  }>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../src/features/files/inspect-worker.cjs', import.meta.url),
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error('worker timed out'));
    }, 20000);
    worker.once('message', (result) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(result);
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      void worker.terminate();
      reject(error);
    });
    worker.postMessage({ bytes, type });
  });
}
async function reserve(
  staff: Actor,
  parentType: 'asset' | 'quantity',
  parent: string,
  version: number,
  name: string,
  type: string,
  bytes: number,
  replaces: string | null = null,
) {
  const replacedVersion = replaces
    ? (
        await db.query(
          'select version::text from public.inventory_files where id=$1',
          [replaces],
        )
      ).rows[0]?.version
    : null;
  return (await okay(staff.client, 'inventory_file_reserve', {
    p_parent_type: parentType,
    p_parent_id: parent,
    p_expected_revision: version,
    p_name: name,
    p_type: type,
    p_bytes: bytes,
    p_replaces: replaces,
    p_expected_file_version: replacedVersion,
  })) as { id: string; path: string };
}

async function expiredTransitionBarrier(
  staff: Actor,
  parent: string,
  keyId: string,
  secret: string,
) {
  const document = await PDFDocument.create();
  document.addPage([80, 80]);
  const bytes = Buffer.from(await document.save());
  const source = await reserve(
    staff,
    'asset',
    parent,
    1,
    'delayed-upload.pdf',
    'application/pdf',
    bytes.length,
  );
  const validated = await reserve(
    staff,
    'asset',
    parent,
    1,
    'delayed-validation.pdf',
    'application/pdf',
    bytes.length,
  );
  for (const file of [source, validated]) {
    const upload = await staff.client.storage
      .from('inventory-files')
      .upload(file.path, bytes, { contentType: 'application/pdf' });
    assert.equal(
      upload.error,
      null,
      'expiry barrier source physically uploads',
    );
  }
  await okay(staff.client, 'inventory_file_uploaded', {
    p_file_id: validated.id,
  });
  const requestId = randomUUID();
  const begun = await okay(staff.client, 'inventory_file_begin', {
    p_file_id: validated.id,
    p_request_id: requestId,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'begin', [validated.id, requestId, keyId]),
  });
  const uploadTxn = new Client({ connectionString: dbUrl });
  const validatedTxn = new Client({ connectionString: dbUrl });
  const guard = new Client({ connectionString: dbUrl });
  await Promise.all([
    uploadTxn.connect(),
    validatedTxn.connect(),
    guard.connect(),
  ]);
  let transitions: Promise<(string | null)[]> | undefined;
  try {
    for (const client of [uploadTxn, validatedTxn]) {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: staff.id, role: 'authenticated' }),
      ]);
      await client.query('set local role authenticated');
    }
    const deadline = await db.query<{ expires: Date }>(
      "select clock_timestamp()+interval '100 milliseconds' expires",
    );
    const expires = deadline.rows[0].expires;
    await db.query(
      'update public.inventory_files set reserve_expires_at=$1 where id=$2',
      [expires, source.id],
    );
    await db.query(
      'update public.inventory_files set validation_lease_until=$1 where id=$2',
      [expires, validated.id],
    );
    const attestation = await db.query<{ statement: string }>(
      'select private.file_attestation_message(f,$2,$3,$4,$5,$6) statement from public.inventory_files f where id=$1',
      [
        validated.id,
        begun.source_id,
        begun.source_version,
        'application/pdf',
        bytes.length,
        sha(bytes),
      ],
    );
    // Real wall clock ages both pre-existing transactions beyond lease grace.
    // This is separate from controlled fixture aging in the admission race.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, expires.getTime() + 31000 - Date.now())),
    );
    const elapsed = await db.query<{ closed: boolean }>(
      "select clock_timestamp()>$1::timestamptz+interval '30 seconds' closed",
      [expires],
    );
    eq(
      elapsed.rows[0].closed,
      true,
      'both original capabilities are expired beyond real grace',
    );
    for (let index = 0; index < 3; index++)
      await reserve(
        staff,
        'asset',
        parent,
        1,
        `after-expiry-${index}.pdf`,
        'application/pdf',
        16,
      );
    await guard.query('begin');
    const holder = await guard.query<{ pid: number }>(
      'select pg_backend_pid() pid',
    );
    await guard.query('select private.file_guard_lock()');
    transitions = Promise.all([
      uploadTxn
        .query('select public.inventory_file_uploaded($1)', [source.id])
        .then(
          () => null,
          (error: { code?: string }) => error.code ?? 'unknown',
        ),
      validatedTxn
        .query(
          'select public.inventory_file_validated($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            validated.id,
            begun.generation,
            keyId,
            begun.source_id,
            begun.source_version,
            'application/pdf',
            bytes.length,
            sha(bytes),
            mac(secret, attestation.rows[0].statement),
          ],
        )
        .then(
          () => null,
          (error: { code?: string }) => error.code ?? 'unknown',
        ),
    ]);
    const waitUntil = performance.now() + 10000;
    let queued = false;
    while (performance.now() < waitUntil) {
      const waiting = await db.query<{ count: string }>(
        `with recursive queue(pid) as (
          select pid from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid))
          union select activity.pid from pg_stat_activity activity join queue holder on holder.pid=any(pg_blocking_pids(activity.pid))
        ) select count(*) from pg_stat_activity where pid in(select pid from queue) and wait_event_type='Lock'
          and (query ilike '%inventory_file_uploaded%' or query ilike '%inventory_file_validated%')`,
        [holder.rows[0].pid],
      );
      if (Number(waiting.rows[0].count) === 2) {
        queued = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(
      queued,
      'both aged independent transactions are observed behind the guard',
    );
    checks++;
    await guard.query('commit');
    eq(
      await transitions,
      ['P1008', 'P1008'],
      'fresh wall clock rejects stale uploaded and validated transitions',
    );
    const rows = await db.query<{ state: string; version: string }>(
      'select state,version::text from public.inventory_files where id=any($1::uuid[]) order by state',
      [[source.id, validated.id]],
    );
    eq(
      rows.rows,
      [
        { state: 'reserved', version: '1' },
        { state: 'validating', version: '3' },
      ],
      'rejected transitions do not revive state or change versions',
    );
    const count = await db.query<{ count: string }>(
      'select count(*) from public.inventory_files f where uploader_id=$1 and private.file_pending_active(f,clock_timestamp())',
      [staff.id],
    );
    eq(
      count.rows[0].count,
      '3',
      'stale transactions cannot revive a fourth or fifth active slot',
    );
    eq(
      sha(await bytesAt(staff.client, source.path)),
      sha(bytes),
      'failed upload notification preserves physical bytes for scoped cleanup',
    );
  } finally {
    await guard.query('rollback').catch(() => undefined);
    await transitions?.catch(() => undefined);
    await Promise.all([
      uploadTxn.query('rollback'),
      validatedTxn.query('rollback'),
    ]);
    await Promise.all([uploadTxn.end(), validatedTxn.end(), guard.end()]);
  }
  await cleanupFailedFixture(staff, keyId, secret);
}

async function pendingAdmissionRace(
  staff: Actor,
  independent: SupabaseClient,
  parent: string,
  retainedParent: string,
  keyId: string,
  secret: string,
) {
  const document = await PDFDocument.create();
  document.addPage([80, 80]);
  const bytes = Buffer.from(await document.save());
  const expired = await reserve(
    staff,
    'asset',
    retainedParent,
    1,
    'renew.pdf',
    'application/pdf',
    bytes.length,
  );
  const uploaded = await staff.client.storage
    .from('inventory-files')
    .upload(expired.path, bytes, { contentType: 'application/pdf' });
  assert.equal(uploaded.error, null, 'renewal race source physically uploads');
  await okay(staff.client, 'inventory_file_uploaded', {
    p_file_id: expired.id,
  });
  // Controlled aging sets up abandoned work. Natural wall-clock completion
  // fencing remains covered by files-completion.ts; no absence is inferred.
  await db.query(
    "update public.inventory_files set reserve_expires_at=clock_timestamp()-interval '2 hours' where id=$1",
    [expired.id],
  );
  await reserve(
    staff,
    'asset',
    parent,
    1,
    'active-one.pdf',
    'application/pdf',
    16,
  );
  await reserve(
    staff,
    'asset',
    parent,
    1,
    'active-two.pdf',
    'application/pdf',
    16,
  );
  const guard = new Client({ connectionString: dbUrl });
  await guard.connect();
  const requestId = randomUUID();
  let requests: Promise<Awaited<ReturnType<typeof rpc>>[]> | undefined;
  try {
    await guard.query('begin');
    const holder = await guard.query<{ pid: number }>(
      'select pg_backend_pid() pid',
    );
    await guard.query('select private.file_guard_lock()');
    requests = Promise.all([
      rpc(staff.client, 'inventory_file_begin', {
        p_file_id: expired.id,
        p_request_id: requestId,
        p_key_id: keyId,
        ...serverProof(secret, staff.id, 'begin', [
          expired.id,
          requestId,
          keyId,
        ]),
      }),
      rpc(independent, 'inventory_file_reserve', {
        p_parent_type: 'asset',
        p_parent_id: parent,
        p_expected_revision: 1,
        p_name: 'new-racer.pdf',
        p_type: 'application/pdf',
        p_bytes: 16,
        p_replaces: null,
        p_expected_file_version: null,
      }),
    ]);
    const deadline = performance.now() + 10000;
    let queued = false;
    while (performance.now() < deadline) {
      const waiting = await db.query<{ count: string }>(
        `with recursive queue(pid) as (
          select pid from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid))
          union
          select activity.pid from pg_stat_activity activity join queue holder
            on holder.pid=any(pg_blocking_pids(activity.pid))
        ) select count(*) from pg_stat_activity where pid in(select pid from queue)
          and wait_event_type='Lock'
          and (query ilike '%inventory_file_begin%' or query ilike '%inventory_file_reserve_ready%')`,
        [holder.rows[0].pid],
      );
      if (Number(waiting.rows[0].count) === 2) {
        queued = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(
      queued,
      'independent reserve and renewal both queue at file_guard',
    );
    checks++;
    await guard.query('commit');
    const results = await requests;
    eq(
      results.filter((result) => !result.error).length,
      1,
      'only reserve or expired renewal can take third active slot',
    );
    eq(
      results.filter((result) => result.error?.code === 'P1012').length,
      1,
      'loser is quota-denied without bypass',
    );
    const active = await db.query<{ count: string }>(
      'select count(*) from public.inventory_files f where uploader_id=$1 and private.file_pending_active(f,clock_timestamp())',
      [staff.id],
    );
    eq(
      active.rows[0].count,
      '3',
      'exactly three active pending files remain after race across parents',
    );
    const state = await db.query<{
      state: string;
      validation_generation: number;
      validation_lease_until: string | null;
    }>(
      'select state,validation_generation,validation_lease_until from public.inventory_files where id=$1',
      [expired.id],
    );
    if (results[0].error) {
      eq(
        state.rows[0],
        {
          state: 'uploaded',
          validation_generation: 0,
          validation_lease_until: null,
        },
        'losing renewal rolls back generation and lease',
      );
    } else {
      eq(
        state.rows[0].state,
        'validating',
        'winning renewal is admitted under fresh lease',
      );
      eq(
        state.rows[0].validation_generation,
        1,
        'winning renewal creates exactly one new generation',
      );
    }
    eq(
      sha(await bytesAt(staff.client, expired.path)),
      sha(bytes),
      'capacity accounting preserves expired source physical bytes',
    );
  } finally {
    await guard.query('rollback').catch(() => undefined);
    await requests?.catch(() => undefined);
    await guard.end();
  }
  await cleanupFailedFixture(staff, keyId, secret);
}

async function cleanupFailedFixture(
  staff: Actor,
  keyId: string,
  secret: string,
) {
  const pending = await db.query<{
    id: string;
    state: string;
    validation_generation: number;
  }>(
    `select id,state,validation_generation from public.inventory_files
     where uploader_id=$1 and state in ('reserved','uploaded','validating','validated')`,
    [staff.id],
  );
  for (const file of pending.rows) {
    if (file.state === 'validating') {
      const rejected = await rpc(staff.client, 'inventory_file_reject', {
        p_file_id: file.id,
        p_generation: file.validation_generation,
        p_key_id: keyId,
        ...serverProof(secret, staff.id, 'reject', [
          file.id,
          String(file.validation_generation),
          keyId,
        ]),
      });
      assert.equal(rejected.error, null, 'fictional validation rejection');
      // Local failure teardown only: terminal rejection fences a late worker
      // completion. Advancing this one fixture's grace clock lets the normal
      // signed cleanup RPC reclaim its source; it is not grace-timing proof.
      await db.query(
        `update public.inventory_files
           set validation_lease_until=clock_timestamp()-interval '31 seconds'
         where id=$1 and uploader_id=$2 and state='rejected'`,
        [file.id, staff.id],
      );
    } else {
      const cancelled = await rpc(staff.client, 'inventory_file_cancel', {
        p_file_id: file.id,
      });
      assert.equal(cancelled.error, null, 'fictional pending cancellation');
    }
  }
  const foreign = await db.query<{ count: string }>(
    `select count(*) from private.file_objects o
       join public.inventory_files f on f.id=o.file_id
      where o.cleanup_state='eligible' and f.uploader_id<>$1`,
    [staff.id],
  );
  assert.equal(
    foreign.rows[0].count,
    '0',
    'failure cleanup refuses to claim another fixture owner',
  );
  for (let batch = 0; batch < 10; batch++) {
    const claims = (await okay(staff.client, 'inventory_file_cleanup_claim', {
      p_limit: 20,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_claim', ['20', keyId]),
    })) as { object_id: string; path: string }[];
    if (!claims.length) break;
    const ownership = await db.query<{ count: string }>(
      `select count(*) from private.file_objects o
         join public.inventory_files f on f.id=o.file_id
        where o.id=any($1::uuid[]) and f.uploader_id=$2`,
      [claims.map((claim) => claim.object_id), staff.id],
    );
    assert.equal(
      Number(ownership.rows[0].count),
      claims.length,
      'failure cleanup claim remains within this test actor',
    );
    for (const claim of claims) {
      const present = await db.query<{ present: boolean }>(
        "select exists(select 1 from storage.objects where bucket_id='inventory-files' and name=$1) present",
        [claim.path],
      );
      if (present.rows[0].present) {
        const removed = await staff.client.storage
          .from('inventory-files')
          .remove([claim.path]);
        assert.equal(removed.error, null, 'fictional Storage cleanup');
      }
      await okay(staff.client, 'inventory_file_cleanup_confirm', {
        p_object_id: claim.object_id,
        p_key_id: keyId,
        ...serverProof(secret, staff.id, 'cleanup_confirm', [
          claim.object_id,
          keyId,
        ]),
      });
    }
  }
  const remaining = await db.query<{ count: string }>(
    `select count(*) from private.file_objects o
       join public.inventory_files f on f.id=o.file_id
      where f.uploader_id=$1 and o.cleanup_state in ('eligible','claimed')`,
    [staff.id],
  );
  assert.equal(remaining.rows[0].count, '0', 'fictional cleanup is complete');
}
async function bytesAt(client: SupabaseClient, path: string) {
  const result = await client.storage.from('inventory-files').download(path);
  assert.equal(result.error, null, `download: ${result.error?.message}`);
  return Buffer.from(await result.data!.arrayBuffer());
}
async function validate(
  staff: Actor,
  keyId: string,
  secret: string,
  file: { id: string; path: string },
  bytes: Buffer,
  type: 'image/png' | 'application/pdf',
  parent: string,
  collectionRevision: number,
  purpose: 'asset_photo' | 'asset_document' | 'recognition_photo',
  requestId = randomUUID(),
  parentType: 'asset' | 'quantity' = 'asset',
  replaces: string | null = null,
  foreignSource?: { id: string; version: string },
) {
  const replacedVersion = replaces
    ? (
        await db.query(
          'select reviewed_replaced_file_version::text as version from public.inventory_files where id=$1',
          [file.id],
        )
      ).rows[0]?.version
    : null;
  const begin = await okay(staff.client, 'inventory_file_begin', {
    p_file_id: file.id,
    p_request_id: requestId,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'begin', [file.id, requestId, keyId]),
  });
  eq(begin.key_id, keyId, 'active key');
  await denied(
    staff.client,
    'inventory_file_reject',
    {
      p_file_id: file.id,
      p_generation: begin.generation,
      p_key_id: keyId,
      p_nonce: '0'.repeat(32),
      p_expires: Math.floor(Date.now() / 1000) + 60,
      p_mac: '0'.repeat(64),
    },
    'P1001',
  );
  const source = await bytesAt(staff.client, file.path);
  eq(sha(source), sha(bytes), 'source bytes after validation began');
  if (type === 'image/png') {
    const race = await staff.client.storage
      .from('inventory-files')
      .upload(file.path, pngBytes(1), { contentType: type, upsert: true });
    assert.ok(race.error, 'source upsert while validating blocked');
    eq(
      sha(await bytesAt(staff.client, file.path)),
      sha(bytes),
      'validation race retains physical source bytes',
    );
    const badGeneration = begin.generation + 1;
    const nonce = randomBytes(16).toString('hex');
    const expiry = Number(begin.lease_until) - 1;
    const signed = `${staff.id}:${file.id}:${badGeneration}:display:${nonce}:${expiry}`;
    const badPath = `d/${keyId}/${file.id}/${badGeneration}/display/${nonce}/${expiry}/${mac(secret, signed)}`;
    const attempt = await staff.client.storage
      .from('inventory-files')
      .upload(badPath, pngBytes(1), { contentType: type });
    assert.ok(attempt.error, 'wrong validation generation blocked');
  }
  const registered: string[] = [];
  if (type === 'image/png') {
    for (const variant of ['display', 'thumbnail'] as const) {
      const body = await sharp(bytes)
        .rotate()
        .resize({
          width: variant === 'display' ? 1600 : 320,
          height: variant === 'display' ? 1600 : 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      const nonce = randomBytes(16).toString('hex');
      const expires = Number(begin.lease_until) - 1;
      const cap = mac(
        secret,
        `${staff.id}:${file.id}:${begin.generation}:${variant}:${nonce}:${expires}`,
      );
      const path = `d/${keyId}/${file.id}/${begin.generation}/${variant}/${nonce}/${expires}/${cap}`;
      const digest = sha(body);
      const early = await staff.client.storage
        .from('inventory-files')
        .upload(path, pngBytes(1), { contentType: 'image/jpeg' });
      assert.ok(
        early.error,
        'derived bytes cannot prepopulate before DB object reservation',
      );
      await denied(
        staff.client,
        'inventory_file_prepare_variant',
        {
          p_file_id: file.id,
          p_generation: begin.generation,
          p_variant: variant,
          p_path: path,
          p_bytes: body.length,
          p_sha256: digest,
          p_mac: '0'.repeat(64),
        },
        'P1001',
      );
      await okay(staff.client, 'inventory_file_prepare_variant', {
        p_file_id: file.id,
        p_generation: begin.generation,
        p_variant: variant,
        p_path: path,
        p_bytes: body.length,
        p_sha256: digest,
        p_mac: mac(
          secret,
          `${staff.id}:${file.id}:${begin.generation}:${variant}:${path}:${body.length}:${digest}`,
        ),
      });
      const uploaded = await staff.client.storage
        .from('inventory-files')
        .upload(path, body, { contentType: 'image/jpeg', upsert: false });
      assert.equal(
        uploaded.error,
        null,
        `derived upload: ${uploaded.error?.message}`,
      );
      const pendingInfo = await staff.client.storage
        .from('inventory-files')
        .info(path);
      assert.ok(pendingInfo.error, 'pending derived object info hidden');
      await denied(
        staff.client,
        'inventory_file_register',
        {
          p_file_id: file.id,
          p_generation: begin.generation,
          p_variant: variant,
          p_path: path,
          p_object_id: uploaded.data!.id,
          p_bytes: body.length,
          p_sha256: digest,
          p_mac: '0'.repeat(64),
        },
        'P1001',
      );
      const registration = await okay(staff.client, 'inventory_file_register', {
        p_file_id: file.id,
        p_generation: begin.generation,
        p_variant: variant,
        p_path: path,
        p_object_id: uploaded.data!.id,
        p_bytes: body.length,
        p_sha256: digest,
        p_mac: mac(
          secret,
          `${staff.id}:${file.id}:${begin.generation}:${variant}:${path}:${uploaded.data!.id}:${body.length}:${digest}`,
        ),
      });
      registered.push(
        `${variant}:${registration.id}:${registration.version}:${body.length}:${digest}`,
      );
    }
  }
  const statement = [
    'v2',
    staff.id,
    file.id,
    begin.generation,
    parentType,
    parent,
    collectionRevision,
    requestId,
    begin.lease_until,
    keyId,
    purpose,
    replaces ?? '-',
    replacedVersion ?? '-',
    begin.source_id,
    begin.source_version,
    type,
    bytes.length,
    sha(bytes),
    registered.sort().join('|'),
  ].join(':');
  if (foreignSource) {
    const substituted = statement.split(':');
    substituted[13] = foreignSource.id;
    substituted[14] = foreignSource.version;
    await denied(
      staff.client,
      'inventory_file_validated',
      {
        p_file_id: file.id,
        p_generation: begin.generation,
        p_key_id: keyId,
        p_source_id: foreignSource.id,
        p_source_version: foreignSource.version,
        p_type: type,
        p_bytes: bytes.length,
        p_sha256: sha(bytes),
        p_mac: mac(secret, substituted.join(':')),
      },
      'P1012',
    );
    eq(
      (
        await db.query('select state from public.inventory_files where id=$1', [
          file.id,
        ])
      ).rows[0].state,
      'validating',
      'correctly signed foreign source cannot advance validation',
    );
  }
  await okay(staff.client, 'inventory_file_validated', {
    p_file_id: file.id,
    p_generation: begin.generation,
    p_key_id: keyId,
    p_source_id: begin.source_id,
    p_source_version: begin.source_version,
    p_type: type,
    p_bytes: bytes.length,
    p_sha256: sha(bytes),
    p_mac: mac(secret, statement),
  });
  return requestId;
}

async function finalizeCancelRace(
  staff: Actor,
  parent: string,
  keyId: string,
  secret: string,
  cancelWins: boolean,
) {
  const document = await PDFDocument.create();
  document.addPage([80, 80]);
  const bytes = Buffer.from(await document.save());
  const file = await reserve(
    staff,
    'asset',
    parent,
    1,
    'publish-cancel.pdf',
    'application/pdf',
    bytes.length,
  );
  const uploaded = await staff.client.storage
    .from('inventory-files')
    .upload(file.path, bytes, { contentType: 'application/pdf' });
  assert.equal(uploaded.error, null, 'race source physically uploaded');
  await okay(staff.client, 'inventory_file_uploaded', { p_file_id: file.id });
  const requestId = await validate(
    staff,
    keyId,
    secret,
    file,
    bytes,
    'application/pdf',
    parent,
    1,
    'asset_document',
  );
  const winner = new Client({
    connectionString: dbUrl,
    application_name: 'files-transition-winner',
  });
  const loser = new Client({
    connectionString: dbUrl,
    application_name: 'files-transition-loser',
  });
  await winner.connect();
  await loser.connect();
  let waiting: Promise<{ code?: string }> | undefined;
  try {
    for (const connection of [winner, loser]) {
      await connection.query('begin');
      await connection.query("set local statement_timeout='10s'");
      await connection.query('set local role authenticated');
      await connection.query(
        "select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({ sub: staff.id, role: 'authenticated' })],
      );
    }
    const winnerPid = (
      await winner.query<{ pid: number }>('select pg_backend_pid() pid')
    ).rows[0].pid;
    const loserPid = (
      await loser.query<{ pid: number }>('select pg_backend_pid() pid')
    ).rows[0].pid;
    eq(
      winnerPid === loserPid,
      false,
      'transition race uses independent connections',
    );
    const finalize =
      'select public.inventory_file_finalize($1::uuid,$2::bigint,$3::uuid)';
    const cancel = 'select public.inventory_file_cancel($1::uuid)';
    const finalArgs = [file.id, 1, requestId];
    await winner.query(
      cancelWins ? cancel : finalize,
      cancelWins ? [file.id] : finalArgs,
    );
    waiting = loser
      .query(cancelWins ? finalize : cancel, cancelWins ? finalArgs : [file.id])
      .then(
        () => ({}),
        (error: { code?: string }) => ({ code: error.code }),
      );
    const deadline = performance.now() + 3000;
    let blocked = false;
    while (performance.now() < deadline) {
      blocked = (
        await db.query<{ blocked: boolean }>(
          "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2::integer=any(pg_blocking_pids(pid))) blocked",
          [loserPid, winnerPid],
        )
      ).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    eq(
      blocked,
      true,
      'losing transition waits while winning transition is uncommitted',
    );
    await winner.query('commit');
    eq(
      (await waiting).code,
      'P1008',
      'losing transition fails after winner commits',
    );
  } finally {
    await winner.query('rollback').catch(() => undefined);
    await waiting;
    await loser.query('rollback').catch(() => undefined);
    await winner.end();
    await loser.end();
  }
  const readback = (
    await db.query(
      `select f.state,f.version::text,o.cleanup_state,c.revision::text,
    (select count(*)::text from public.inventory_file_events where file_id=f.id) events,
    (select count(*)::text from private.file_receipts where actor_id=$2 and request_id=$3 and result is not null) receipts
    from public.inventory_files f join private.file_objects o on o.file_id=f.id
    join public.inventory_file_collections c on c.asset_id=f.asset_id where f.id=$1`,
      [file.id, staff.id, requestId],
    )
  ).rows[0];
  eq(
    readback.state,
    cancelWins ? 'cancelled' : 'ready',
    'committed race winner determines stable file state',
  );
  eq(
    readback.cleanup_state,
    cancelWins ? 'eligible' : 'held',
    'only cancelled bytes become cleanup eligible',
  );
  eq(
    readback.revision,
    cancelWins ? '1' : '2',
    'only publication increments collection',
  );
  eq(
    readback.events,
    cancelWins ? '0' : '1',
    'publication event commits exactly once',
  );
  eq(
    readback.receipts,
    cancelWins ? '0' : '1',
    'failed finalize leaves no completed receipt',
  );
  if (cancelWins) {
    // Cancellation has only a file-ID argument, not a receipt/request token.
    // Both an identical retry and a fresh invocation on this terminal file must
    // report invalid_transition without repeating its committed side effects.
    const cancelArgs = { p_file_id: file.id };
    await denied(staff.client, 'inventory_file_cancel', cancelArgs, 'P1008');
    await denied(
      staff.client,
      'inventory_file_cancel',
      { ...cancelArgs },
      'P1008',
    );
    eq(
      (
        await db.query(
          `select f.state,f.version::text,o.cleanup_state,c.revision::text,
          (select count(*)::text from public.inventory_file_events where file_id=f.id) events,
          (select count(*)::text from private.file_receipts where actor_id=$2 and request_id=$3 and result is not null) receipts
          from public.inventory_files f join private.file_objects o on o.file_id=f.id
          join public.inventory_file_collections c on c.asset_id=f.asset_id where f.id=$1`,
          [file.id, staff.id, requestId],
        )
      ).rows[0],
      readback,
      'repeated cancellation retains terminal state/version, collection, objects and event/receipt counts',
    );
    eq(
      sha(await bytesAt(admin, file.path)),
      sha(bytes),
      'repeated cancellation leaves physical source for truthful normal cleanup',
    );
    await denied(
      staff.client,
      'inventory_file_finalize',
      { p_file_id: file.id, p_expected_revision: 1, p_request_id: requestId },
      'P1008',
    );
    // Teardown ages only this terminal fixture; race ordering above uses real locks.
    await db.query(
      "update public.inventory_files set validation_lease_until=clock_timestamp()-interval '31 seconds' where id=$1 and state='cancelled'",
      [file.id],
    );
  } else {
    await denied(
      staff.client,
      'inventory_file_cancel',
      { p_file_id: file.id },
      'P1008',
    );
    await okay(staff.client, 'inventory_file_finalize', {
      p_file_id: file.id,
      p_expected_revision: 1,
      p_request_id: requestId,
    });
  }
  const claims = (await okay(
    staff.client,
    'inventory_file_cleanup_claim_parent',
    {
      p_parent_type: 'asset',
      p_parent_id: parent,
      p_limit: 20,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_claim', [
        'asset',
        parent,
        '20',
        keyId,
      ]),
    },
  )) as { object_id: string; path: string }[];
  eq(
    claims.map((claim) => claim.path),
    cancelWins ? [file.path] : [],
    'cleanup never claims published live source',
  );
  for (const claim of claims) {
    const removed = await staff.client.storage
      .from('inventory-files')
      .remove([claim.path]);
    assert.equal(
      removed.error,
      null,
      'cancel winner deletes its exact physical source',
    );
    await okay(staff.client, 'inventory_file_cleanup_confirm', {
      p_object_id: claim.object_id,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_confirm', [
        claim.object_id,
        keyId,
      ]),
    });
  }
  if (cancelWins) {
    await denied(
      staff.client,
      'inventory_file_cancel',
      { p_file_id: file.id },
      'P1008',
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      eq(
        await okay(staff.client, 'inventory_file_cleanup_claim_parent', {
          p_parent_type: 'asset',
          p_parent_id: parent,
          p_limit: 20,
          p_key_id: keyId,
          ...serverProof(secret, staff.id, 'cleanup_claim', [
            'asset',
            parent,
            '20',
            keyId,
          ]),
        }),
        [],
        'repeated cleanup claims no objects after cancelled source deletion',
      );
      eq(
        await okay(staff.client, 'inventory_file_cleanup_status', {
          p_parent_type: 'asset',
          p_parent_id: parent,
        }),
        { outstanding: 0, blocked: 0 },
        'authoritative repeated cleanup status is zero work',
      );
    }
    await denied(
      staff.client,
      'inventory_file_finalize',
      {
        p_file_id: file.id,
        p_expected_revision: 1,
        p_request_id: requestId,
      },
      'P1008',
    );
  }
  const finalState = (
    await db.query(
      'select state,version::text from public.inventory_files where id=$1',
      [file.id],
    )
  ).rows[0];
  eq(
    finalState,
    { state: readback.state, version: readback.version },
    'losing retry and cleanup cannot resurrect or mutate winning file',
  );
  if (cancelWins) {
    eq(
      (
        await db.query(
          "select count(*)::text count from storage.objects where bucket_id='inventory-files' and name=$1",
          [file.path],
        )
      ).rows[0].count,
      '0',
      'cancelled physical object absent',
    );
    assert.ok(
      (await admin.storage.from('inventory-files').download(file.path)).error,
      'cancelled physical bytes unavailable through privileged Storage read',
    );
    checks++;
  } else {
    eq(
      sha(await bytesAt(staff.client, file.path)),
      sha(bytes),
      'published live bytes survive losing cancel and cleanup',
    );
  }
}

async function crossParentStorageSubstitution(
  staff: Actor,
  parents: [string, string],
  keyId: string,
  secret: string,
) {
  const document = await PDFDocument.create();
  document.addPage([80, 80]);
  const bytes = Buffer.from(await document.save());
  const files = [];
  for (const parent of parents) {
    const file = await reserve(
      staff,
      'asset',
      parent,
      1,
      'parent-bound.pdf',
      'application/pdf',
      bytes.length,
    );
    const uploaded = await staff.client.storage
      .from('inventory-files')
      .upload(file.path, bytes, { contentType: 'application/pdf' });
    assert.equal(
      uploaded.error,
      null,
      'cross-parent source physically uploaded',
    );
    await okay(staff.client, 'inventory_file_uploaded', { p_file_id: file.id });
    files.push(file);
  }
  const [target, foreign] = files;
  const requestId = await validate(
    staff,
    keyId,
    secret,
    foreign,
    bytes,
    'application/pdf',
    parents[1],
    1,
    'asset_document',
  );
  await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: foreign.id,
    p_expected_revision: 1,
    p_request_id: requestId,
  });
  const identity = (
    await db.query(
      "select id,version from storage.objects where bucket_id='inventory-files' and name=$1",
      [foreign.path],
    )
  ).rows[0] as { id: string; version: string };
  const physicalIdentitySql =
    "select name,id,version,metadata->>'size' as bytes from storage.objects where bucket_id='inventory-files' and name=any($1::text[]) order by name";
  const physicalIdentities = (
    await db.query(physicalIdentitySql, [files.map((file) => file.path)])
  ).rows;
  // Same active staff is allowed to read both parents. The boundary is sealed
  // object identity and parent-bound attestation, not an invented read denial.
  const foreignBytes = await bytesAt(staff.client, foreign.path);
  eq(
    sha(foreignBytes),
    sha(bytes),
    'same staff can read foreign ready source before substitution',
  );
  const substitutions = [
    () =>
      staff.client.storage
        .from('inventory-files')
        .copy(foreign.path, target.path),
    () =>
      staff.client.storage
        .from('inventory-files')
        .move(foreign.path, target.path),
    () =>
      staff.client.storage
        .from('inventory-files')
        .upload(target.path, foreignBytes, {
          contentType: 'application/pdf',
          upsert: true,
        }),
  ];
  for (const [index, operation] of substitutions.entries()) {
    const result = await operation();
    assert.ok(
      result.error,
      'actual Storage cross-parent sealed path substitution denied',
    );
    if (index === 2) {
      eq(
        (result.error as { statusCode?: string }).statusCode,
        '403',
        'foreign ready bytes cannot overwrite another sealed parent source',
      );
    }
    const error = result.error as {
      status?: number;
      statusCode?: string;
      code?: string;
    };
    console.log(
      'Cross-parent Storage substitution outcome:',
      JSON.stringify({
        operation: ['copy', 'move', 'upsert'][index],
        status: Number.isInteger(error.status) ? error.status : null,
        statusCode: /^\d{3}$/.test(error.statusCode ?? '')
          ? error.statusCode
          : null,
        code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.code ?? '')
          ? error.code
          : null,
      }),
    );
    checks++;
  }
  eq(
    (await db.query(physicalIdentitySql, [files.map((file) => file.path)]))
      .rows,
    physicalIdentities,
    'cross-parent Storage attempts retain both exact object IDs, versions and sizes',
  );
  const targetRequest = await validate(
    staff,
    keyId,
    secret,
    target,
    bytes,
    'application/pdf',
    parents[0],
    1,
    'asset_document',
    randomUUID(),
    'asset',
    null,
    identity,
  );
  await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: target.id,
    p_expected_revision: 1,
    p_request_id: targetRequest,
  });
  for (const [index, file] of files.entries()) {
    eq(
      await okay(staff.client, 'inventory_file_read', {
        p_file_id: file.id,
        p_variant: 'source',
      }),
      file.path,
      'ready read resolves its own immutable source',
    );
    eq(
      sha(await bytesAt(staff.client, file.path)),
      sha(bytes),
      'cross-parent attempts preserve both physical sources',
    );
    eq(
      (
        await db.query(
          'select asset_id,state from public.inventory_files where id=$1',
          [file.id],
        )
      ).rows[0],
      { asset_id: parents[index], state: 'ready' },
      'publication retains exact original parent',
    );
    eq(
      (
        await db.query(
          'select asset_id from public.inventory_file_events where file_id=$1',
          [file.id],
        )
      ).rows.map((row) => row.asset_id),
      [parents[index]],
      'publication history cannot substitute another parent',
    );
  }
}

async function main() {
  await db.connect();
  const keyId = 'files' + randomBytes(4).toString('hex');
  const secret = randomBytes(48).toString('hex');
  await db.query(
    "insert into private.file_keys(key_id,secret,accepts_new,verify_until) values($1,$2,true,now()+interval '2 hours')",
    [keyId, secret],
  );
  keyToRetire = keyId;
  keySecretForCleanup = secret;
  const staff = await actor('staff');
  const viewer = await actor('viewer');
  const {
    rows: [cat],
  } = await db.query('select id from public.categories limit 1');
  const {
    rows: [loc],
  } = await db.query(
    'select id from public.locations where active and can_hold_inventory limit 1',
  );
  const parent = await asset(staff, cat.id, loc.id);
  checks += await cleanupClockChecks(
    db,
    dbUrl,
    staff.id,
    viewer.id,
    await asset(staff, cat.id, loc.id),
    keyId,
    secret,
  );
  // A cleanup request waiting on the global file guard must not hold the
  // inventory parent lock and block an unrelated metadata writer.
  const guardHolder = new Client({ connectionString: dbUrl });
  const parentWriter = new Client({ connectionString: dbUrl });
  await guardHolder.connect();
  await parentWriter.connect();
  let waitingClaim: Promise<{ data: unknown; error: unknown }> | undefined;
  try {
    await guardHolder.query('begin');
    const holder = await guardHolder.query<{ pid: number }>(
      'select pg_backend_pid() pid',
    );
    await guardHolder.query('select id from private.file_guard for update');
    waitingClaim = Promise.resolve(
      staff.client.rpc('inventory_file_cleanup_claim_parent', {
        p_parent_type: 'asset',
        p_parent_id: parent,
        p_limit: 1,
        p_key_id: keyId,
        ...serverProof(secret, staff.id, 'cleanup_claim', [
          'asset',
          parent,
          '1',
          keyId,
        ]),
      }),
    ).then((result) => ({ data: result.data, error: result.error }));
    const deadline = performance.now() + 1500;
    let observed = false;
    while (performance.now() < deadline) {
      const blocked = await db.query<{ present: boolean }>(
        "select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike '%inventory_file_cleanup_claim_parent%' and $1::integer=any(pg_blocking_pids(pid))) present",
        [holder.rows[0].pid],
      );
      if (blocked.rows[0].present) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(
      observed,
      'scoped cleanup is observed waiting for the global guard',
    );
    await parentWriter.query('begin');
    await parentWriter.query("set local statement_timeout='500ms'");
    await parentWriter.query(
      'select id from public.serialized_assets where id=$1 for update',
      [parent],
    );
    await parentWriter.query('commit');
    await guardHolder.query('commit');
    const claimed = await waitingClaim;
    assert.equal(claimed.error, null, 'claim completes after guard release');
    eq(claimed.data, [], 'empty parent stays empty after lock-order race');
    checks += 2;
  } finally {
    await parentWriter.query('rollback').catch(() => undefined);
    await guardHolder.query('rollback').catch(() => undefined);
    await waitingClaim?.catch(() => undefined);
    await parentWriter.end();
    await guardHolder.end();
  }
  const independent = await independentSession(staff);
  await pendingAdmissionRace(
    staff,
    independent,
    parent,
    await asset(staff, cat.id, loc.id),
    keyId,
    secret,
  );
  await expiredTransitionBarrier(staff, parent, keyId, secret);
  for (const cancelWins of [true, false]) {
    await finalizeCancelRace(
      staff,
      await asset(staff, cat.id, loc.id),
      keyId,
      secret,
      cancelWins,
    );
  }
  await crossParentStorageSubstitution(
    staff,
    [await asset(staff, cat.id, loc.id), await asset(staff, cat.id, loc.id)],
    keyId,
    secret,
  );
  const uploadCancel = await reserve(
    staff,
    'asset',
    parent,
    1,
    'upload-cancel.pdf',
    'application/pdf',
    1,
  );
  const racingBytes = 2 * 1048576;
  // A separately signed-in subprocess initiates Storage INSERT before this
  // connection cancels the file. Either side may win the file-row lock.
  // Either Storage INSERT or cancellation may win, but neither outcome may
  // leave a terminal object charged at the browser's one-byte declaration.
  const { uploadOutcome, cancelOutcome } = await raceStorageUploadWithCancel(
    staff,
    uploadCancel.path,
    uploadCancel.id,
  );
  assert.equal(
    cancelOutcome.error,
    null,
    `upload/cancel race: ${cancelOutcome.error?.message}`,
  );
  const raceAccounting = await db.query(
    `select f.state,fo.cleanup_state,fo.bytes::text charged_bytes,
      (so.metadata->>'size')::bigint::text physical_bytes
     from public.inventory_files f join private.file_objects fo on fo.file_id=f.id
     left join storage.objects so on so.bucket_id='inventory-files' and so.name=fo.path
     where f.id=$1`,
    [uploadCancel.id],
  );
  eq(
    raceAccounting.rows[0].state,
    'cancelled',
    'upload/cancel race reaches terminal state',
  );
  eq(
    raceAccounting.rows[0].cleanup_state,
    'eligible',
    'upload/cancel race preserves cleanup row',
  );
  eq(
    raceAccounting.rows[0].charged_bytes,
    '20971520',
    'upload/cancel race retains full source charge',
  );
  if (!uploadOutcome.error)
    eq(
      raceAccounting.rows[0].physical_bytes,
      String(racingBytes),
      'successful racing upload remains physically accounted',
    );
  const racedClaim = await okay(staff.client, 'inventory_file_cleanup_claim', {
    p_limit: 1,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'cleanup_claim', ['1', keyId]),
  });
  eq(
    racedClaim[0].path,
    uploadCancel.path,
    'race cleanup selects exact reserved path',
  );
  if (raceAccounting.rows[0].physical_bytes !== null) {
    const deletion = await staff.client.storage
      .from('inventory-files')
      .remove([uploadCancel.path]);
    assert.equal(
      deletion.error,
      null,
      `race cleanup: ${deletion.error?.message}`,
    );
  }
  await okay(staff.client, 'inventory_file_cleanup_confirm', {
    p_object_id: racedClaim[0].object_id,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'cleanup_confirm', [
      racedClaim[0].object_id,
      keyId,
    ]),
  });
  const dishonestBytes = Buffer.alloc(20971519, 0x20);
  Buffer.from('%PDF-').copy(dishonestBytes);
  // Browser File uploads use Storage's multipart path. The preceding cancel
  // race deliberately exercises the raw Buffer path separately.
  const dishonestFile = new Blob([dishonestBytes], { type: 'application/pdf' });
  const cancelledPaths: string[] = [];
  for (let index = 0; index < 5; index++) {
    const reservation = await reserve(
      staff,
      'asset',
      parent,
      1,
      `dishonest-${index}.pdf`,
      'application/pdf',
      1,
    );
    const upload = await staff.client.storage
      .from('inventory-files')
      .upload(reservation.path, dishonestFile, {
        contentType: 'application/pdf',
      });
    assert.equal(
      upload.error,
      null,
      `false-size physical upload ${index}: ${upload.error?.message}`,
    );
    if (index === 0) {
      eq(
        sha(await bytesAt(staff.client, reservation.path)),
        sha(dishonestBytes),
        'false declaration does not change physical source bytes',
      );
      await denied(
        staff.client,
        'inventory_file_uploaded',
        {
          p_file_id: reservation.id,
        },
        'P1012',
      );
    }
    await okay(staff.client, 'inventory_file_cancel', {
      p_file_id: reservation.id,
    });
    cancelledPaths.push(reservation.path);
  }
  const nearCap = (name: string) => ({
    p_parent_type: 'asset',
    p_parent_id: parent,
    p_expected_revision: 1,
    p_name: name,
    p_type: 'application/pdf',
    p_bytes: 1,
    p_replaces: null,
  });
  const simultaneous = await Promise.all([
    rpc(staff.client, 'inventory_file_reserve', nearCap('sixth-a.pdf')),
    rpc(independent, 'inventory_file_reserve', nearCap('sixth-b.pdf')),
  ]);
  eq(
    simultaneous.filter((entry) => !entry.error).length,
    1,
    'independent requests cannot both cross the 128 MiB staging limit',
  );
  eq(
    simultaneous.filter((entry) => entry.error?.code === 'P1012').length,
    1,
    'losing concurrent reservation is quota-denied',
  );
  const sixth = simultaneous.find((entry) => !entry.error)!.data as {
    id: string;
    path: string;
  };
  const sixthUpload = await independent.storage
    .from('inventory-files')
    .upload(sixth.path, dishonestFile, { contentType: 'application/pdf' });
  assert.equal(
    sixthUpload.error,
    null,
    `sixth physical upload: ${sixthUpload.error?.message}`,
  );
  await okay(staff.client, 'inventory_file_cancel', { p_file_id: sixth.id });
  cancelledPaths.push(sixth.path);
  const falseSizeAccounting = await db.query(
    `select sum((so.metadata->>'size')::bigint)::text physical_bytes,
      sum(fo.bytes)::text charged_bytes
     from private.file_objects fo join storage.objects so
      on so.bucket_id='inventory-files' and so.name=fo.path
     where fo.path=any($1::text[])`,
    [cancelledPaths],
  );
  eq(
    falseSizeAccounting.rows[0],
    {
      physical_bytes: String(dishonestBytes.length * 6),
      charged_bytes: String(20971520 * 6),
    },
    'terminal false-size uploads retain full source allowance',
  );
  const seventh = {
    p_parent_type: 'asset',
    p_parent_id: parent,
    p_expected_revision: 1,
    p_name: 'seventh.pdf',
    p_type: 'application/pdf',
    p_bytes: 1,
    p_replaces: null,
  };
  await denied(staff.client, 'inventory_file_reserve', seventh, 'P1012');
  const falseSizeClaims = await okay(
    staff.client,
    'inventory_file_cleanup_claim',
    {
      p_limit: 10,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_claim', ['10', keyId]),
    },
  );
  eq(
    falseSizeClaims.map((claim: { path: string }) => claim.path).sort(),
    [...cancelledPaths].sort(),
    'cleanup selects all false-size terminal objects',
  );
  for (const claim of falseSizeClaims) {
    const deleted = await staff.client.storage
      .from('inventory-files')
      .remove([claim.path]);
    assert.equal(
      deleted.error,
      null,
      `false-size cleanup deletion: ${deleted.error?.message}`,
    );
  }
  await denied(staff.client, 'inventory_file_reserve', seventh, 'P1012');
  for (const claim of falseSizeClaims) {
    await okay(staff.client, 'inventory_file_cleanup_confirm', {
      p_object_id: claim.object_id,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_confirm', [
        claim.object_id,
        keyId,
      ]),
    });
  }
  const released = await okay(staff.client, 'inventory_file_reserve', seventh);
  await okay(staff.client, 'inventory_file_cancel', { p_file_id: released.id });
  const emptyClaim = await okay(staff.client, 'inventory_file_cleanup_claim', {
    p_limit: 10,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'cleanup_claim', ['10', keyId]),
  });
  eq(
    emptyClaim.length,
    1,
    'unused reservation remains charged until absence confirmed',
  );
  await okay(staff.client, 'inventory_file_cleanup_confirm', {
    p_object_id: emptyClaim[0].object_id,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'cleanup_confirm', [
      emptyClaim[0].object_id,
      keyId,
    ]),
  });
  const png = pngBytes(220);
  const inspectedImage = await inspect(png, 'image/png');
  assert.ok(
    inspectedImage.ok && inspectedImage.variants?.length === 2,
    'bounded worker normalizes image',
  );
  const heic = Buffer.from('0000ftypheic');
  const inspectedHeic = await inspect(heic, 'image/jpeg');
  assert.ok(
    !inspectedHeic.ok && inspectedHeic.message?.includes('HEIC'),
    'HEIC conversion message',
  );
  const file = await reserve(
    staff,
    'asset',
    parent,
    1,
    'front.png',
    'image/png',
    png.length,
  );
  await denied(
    staff.client,
    'inventory_file_reserve',
    {
      p_parent_type: 'asset',
      p_parent_id: parent,
      p_expected_revision: null,
      p_name: 'bad.png',
      p_type: 'image/png',
      p_bytes: png.length,
      p_replaces: null,
    },
    'P1012',
  );
  await denied(
    staff.client,
    'inventory_file_finalize',
    {
      p_file_id: file.id,
      p_expected_revision: null,
      p_request_id: randomUUID(),
    },
    'P1012',
  );
  await denied(
    staff.client,
    'inventory_file_begin',
    {
      p_file_id: file.id,
      p_request_id: randomUUID(),
      p_key_id: keyId,
      p_nonce: '0'.repeat(32),
      p_expires: Math.floor(Date.now() / 1000) + 60,
      p_mac: '0'.repeat(64),
    },
    'P1001',
  );
  await denied(
    staff.client,
    'inventory_file_cleanup_claim',
    {
      p_limit: null,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_claim', ['10', keyId]),
    },
    'P1012',
  );
  await db.query(
    'update public.app_members set active=false where user_id=$1',
    [staff.id],
  );
  const inactiveUpload = await staff.client.storage
    .from('inventory-files')
    .upload(file.path, png, { contentType: 'image/png' });
  assert.ok(
    inactiveUpload.error,
    'inactive uploader cannot use live reservation',
  );
  await db.query('update public.app_members set active=true where user_id=$1', [
    staff.id,
  ]);
  await denied(
    viewer.client,
    'inventory_file_read',
    { p_file_id: file.id, p_variant: 'source' },
    'P1010',
  );
  const uploaded = await staff.client.storage
    .from('inventory-files')
    .upload(file.path, png, { contentType: 'image/png', upsert: false });
  assert.equal(
    uploaded.error,
    null,
    `source upload: ${uploaded.error?.message}`,
  );
  await okay(staff.client, 'inventory_file_uploaded', { p_file_id: file.id });
  const pendingList = await okay(
    viewer.client,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: [parent],
      p_quantity_ids: [],
    },
  );
  eq(
    pendingList[0].thumbnail_path,
    null,
    'pending source and derived paths stay out of list',
  );
  eq(pendingList[0].photo_count, 0, 'pending photo is absent from ready count');
  eq(
    sha(await bytesAt(staff.client, file.path)),
    sha(png),
    'uploaded original',
  );
  const duplicate = await staff.client.storage
    .from('inventory-files')
    .upload(file.path, pngBytes(10), {
      contentType: 'image/png',
      upsert: false,
    });
  assert.ok(duplicate.error, 'duplicate INSERT blocked');
  const upsert = await staff.client.storage
    .from('inventory-files')
    .upload(file.path, pngBytes(10), {
      contentType: 'image/png',
      upsert: true,
    });
  assert.ok(upsert.error, 'upsert blocked');
  const moved = await staff.client.storage
    .from('inventory-files')
    .move(file.path, 'unreserved/moved');
  assert.ok(moved.error, 'move blocked');
  const copied = await staff.client.storage
    .from('inventory-files')
    .copy(file.path, 'unreserved/copied');
  assert.ok(copied.error, 'copy blocked');
  eq(
    sha(await bytesAt(staff.client, file.path)),
    sha(png),
    'rejected writes retain physical source bytes',
  );
  const list = await viewer.client.storage.from('inventory-files').list('');
  eq(list.data ?? [], [], 'viewer list does not reveal paths');
  const sourceInfo = await viewer.client.storage
    .from('inventory-files')
    .info(file.path);
  assert.ok(sourceInfo.error, 'viewer pending source info blocked');
  const forged = await staff.client.storage
    .from('inventory-files')
    .upload(
      `d/${keyId}/${file.id}/1/display/${'0'.repeat(32)}/9999999999/${'0'.repeat(64)}`,
      png,
      { contentType: 'image/png' },
    );
  assert.ok(forged.error, 'forged derived capability blocked');
  const requestId = await validate(
    staff,
    keyId,
    secret,
    file,
    png,
    'image/png',
    parent,
    1,
    'asset_photo',
  );
  await denied(
    staff.client,
    'inventory_file_finalize',
    { p_file_id: file.id, p_expected_revision: 1, p_request_id: randomUUID() },
    'P1008',
  );
  const [finalized, racedReplay] = await Promise.all([
    okay(staff.client, 'inventory_file_finalize', {
      p_file_id: file.id,
      p_expected_revision: 1,
      p_request_id: requestId,
    }),
    okay(staff.client, 'inventory_file_finalize', {
      p_file_id: file.id,
      p_expected_revision: 1,
      p_request_id: requestId,
    }),
  ]);
  eq(racedReplay, finalized, 'concurrent receipt replay serializes');
  eq(
    finalized.collection_revision,
    '2',
    'file event increments only collection revision',
  );
  const replay = await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: file.id,
    p_expected_revision: 1,
    p_request_id: requestId,
  });
  eq(replay, finalized, 'completed receipt replay');
  const readyPath = (await okay(viewer.client, 'inventory_file_read', {
    p_file_id: file.id,
    p_variant: 'display',
  })) as string;
  assert.ok(
    (await bytesAt(viewer.client, readyPath)).length > 0,
    'viewer reads normalized display',
  );
  const readyDigest = sha(await bytesAt(viewer.client, readyPath));
  const expectedDisplay = await sharp(png)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  eq(
    readyDigest,
    sha(expectedDisplay),
    'denied prepopulation did not change physical derived bytes',
  );
  const readyInfo = await viewer.client.storage
    .from('inventory-files')
    .info(readyPath);
  assert.equal(readyInfo.error, null, 'viewer may inspect ready object info');
  const readyUpsert = await staff.client.storage
    .from('inventory-files')
    .upload(readyPath, pngBytes(3), {
      contentType: 'image/jpeg',
      upsert: true,
    });
  assert.ok(readyUpsert.error, 'ready derived upsert blocked');
  const readyMove = await staff.client.storage
    .from('inventory-files')
    .move(readyPath, 'unreserved/ready-move');
  assert.ok(readyMove.error, 'ready derived move blocked');
  const readyCopy = await staff.client.storage
    .from('inventory-files')
    .copy(readyPath, 'unreserved/ready-copy');
  assert.ok(readyCopy.error, 'ready derived copy blocked');
  eq(
    sha(await bytesAt(viewer.client, readyPath)),
    readyDigest,
    'rejected operations retain physical ready bytes',
  );
  const directMetadata = await staff.client
    .from('inventory_files')
    .select('source_path')
    .eq('id', file.id);
  assert.ok(
    directMetadata.error || !directMetadata.data?.length,
    'direct metadata path select denied',
  );
  const directDelete = await staff.client
    .from('inventory_files')
    .delete()
    .eq('id', file.id);
  assert.ok(directDelete.error, 'client direct metadata deletion denied');
  const hiddenStaging = await viewer.client.storage
    .from('inventory-files')
    .download(file.path);
  assert.ok(hiddenStaging.error, 'original photo is never a ready read');
  const prematureDelete = await staff.client.storage
    .from('inventory-files')
    .remove([readyPath]);
  assert.ok(
    prematureDelete.error || !prematureDelete.data?.length,
    'ready object cannot be selected for deletion',
  );
  assert.ok(
    (await bytesAt(viewer.client, readyPath)).length > 0,
    'denied deletion retains physical ready bytes',
  );
  const cards = await okay(viewer.client, 'inventory_file_cards', {
    p_parent_type: 'asset',
    p_parent_id: parent,
  });
  eq(cards.revision, '2', 'collection revision visible to viewer');
  eq(cards.files.length, 1, 'ready card shown to viewer');
  const initialInventory = await db.query(
    'select a.version, (select count(*) from public.asset_events e where e.asset_id=a.id and e.kind::text like $2) file_events from public.serialized_assets a where a.id=$1',
    [parent, 'file_%'],
  );
  eq(
    initialInventory.rows[0].file_events,
    '0',
    'publishing a file creates no inventory event',
  );
  eq(
    (
      await okay(viewer.client, 'inventory_file_history', {
        p_parent_type: 'asset',
        p_parent_id: parent,
        p_page: 1,
      })
    ).rows[0].action,
    'added',
    'separate append-only file history records publication',
  );
  const directCollections = await viewer.client
    .from('inventory_file_collections')
    .select('id')
    .limit(1);
  assert.ok(directCollections.error, 'direct file collection reads are denied');
  const directEvents = await viewer.client
    .from('inventory_file_events')
    .select('id')
    .limit(1);
  assert.ok(directEvents.error, 'direct file history reads are denied');
  checks += 2;
  eq(
    typeof cards.files[0].version,
    'string',
    'new file versions use decimal strings',
  );
  eq(Object.hasOwn(cards.files[0], 'path'), false, 'card omits path');
  const thumbnailPath = (await okay(viewer.client, 'inventory_file_read', {
    p_file_id: file.id,
    p_variant: 'thumbnail',
  })) as string;
  const listThumbnails = await okay(
    viewer.client,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: [parent],
      p_quantity_ids: [],
    },
  );
  eq(
    listThumbnails,
    [
      {
        kind: 'asset',
        id: parent,
        thumbnail_path: thumbnailPath,
        photo_name: 'front.png',
        photo_count: 1,
        document_count: 0,
      },
    ],
    'bounded list projection shows only ready private thumbnail',
  );
  await denied(
    viewer.client,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: Array(26).fill(parent),
      p_quantity_ids: [],
    },
    'P1012',
  );
  await denied(
    anonymous,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: [parent],
      p_quantity_ids: [],
    },
    '42501',
  );
  await db.query(
    'update public.inventory_files set version=9007199254740993 where id=$1',
    [file.id],
  );
  const precisionCards = await okay(viewer.client, 'inventory_file_cards', {
    p_parent_type: 'asset',
    p_parent_id: parent,
  });
  eq(
    precisionCards.files[0].version,
    '9007199254740993',
    'bigint file version remains exact decimal text',
  );
  await denied(
    anonymous,
    'inventory_file_cards',
    { p_parent_type: 'asset', p_parent_id: parent },
    '42501',
  );

  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const pdfBytes = Buffer.from(await pdf.save());
  const inspectedPdf = await inspect(pdfBytes, 'application/pdf');
  assert.ok(
    inspectedPdf.ok && inspectedPdf.variants?.length === 0,
    'bounded worker parses PDF',
  );
  const pdfFile = await reserve(
    staff,
    'asset',
    parent,
    2,
    'manual.pdf',
    'application/pdf',
    pdfBytes.length,
  );
  const pdfUpload = await staff.client.storage
    .from('inventory-files')
    .upload(pdfFile.path, pdfBytes, { contentType: 'application/pdf' });
  assert.equal(pdfUpload.error, null);
  await okay(staff.client, 'inventory_file_uploaded', {
    p_file_id: pdfFile.id,
  });
  const pdfRequest = await validate(
    staff,
    keyId,
    secret,
    pdfFile,
    pdfBytes,
    'application/pdf',
    parent,
    2,
    'asset_document',
  );
  await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: pdfFile.id,
    p_expected_revision: 2,
    p_request_id: pdfRequest,
  });
  const pdfReady = (await okay(viewer.client, 'inventory_file_read', {
    p_file_id: pdfFile.id,
    p_variant: 'source',
  })) as string;
  eq(
    sha(await bytesAt(viewer.client, pdfReady)),
    sha(pdfBytes),
    'inspected PDF original remains live',
  );
  await db.query(
    "update public.inventory_files set validation_lease_until=now()-interval '10 minutes' where id=any($1::uuid[])",
    [[file.id, pdfFile.id]],
  );
  const claims = await okay(staff.client, 'inventory_file_cleanup_claim', {
    p_limit: 10,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'cleanup_claim', ['10', keyId]),
  });
  assert.ok(
    claims.some((claim: { path: string }) => claim.path === file.path),
    'staged photo source eligible',
  );
  assert.ok(
    !claims.some((claim: { path: string }) => claim.path === pdfReady),
    'ready PDF original excluded',
  );
  const sourceClaim = claims.find(
    (claim: { path: string }) => claim.path === file.path,
  );
  await denied(
    staff.client,
    'inventory_file_cleanup_confirm',
    {
      p_object_id: sourceClaim.object_id,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_confirm', [
        sourceClaim.object_id,
        keyId,
      ]),
    },
    'P1012',
  );
  await db.query(
    "update private.file_objects set cleanup_lease_until=now()-interval '1 minute' where id=$1",
    [sourceClaim.object_id],
  );
  const reclaimed = await okay(staff.client, 'inventory_file_cleanup_claim', {
    p_limit: 10,
    p_key_id: keyId,
    ...serverProof(secret, staff.id, 'cleanup_claim', ['10', keyId]),
  });
  assert.ok(
    reclaimed.some(
      (claim: { object_id: string }) =>
        claim.object_id === sourceClaim.object_id,
    ),
    'interrupted deletion is claimable after lease',
  );
  await db.query(
    "update private.file_objects set cleanup_lease_until=now()-interval '1 minute' where id=$1",
    [sourceClaim.object_id],
  );
  const lostConfirmation = await cleanupWithLostConfirmation(
    staff,
    parent,
    keyId,
    secret,
  );
  eq(
    lostConfirmation.committed,
    1,
    'real cleanup confirmation committed before response delivery was lost',
  );
  eq(
    lostConfirmation.result,
    {
      deleted: 0,
      failed: 0,
      outstanding: 0,
      blocked: 0,
      pending: false,
      status: 'complete',
    },
    'actual server service settles lost confirmation using authorized final zero work without inferring deleted count',
  );
  const tombstone = await db.query(
    'select cleanup_state,path from private.file_objects where id=$1',
    [sourceClaim.object_id],
  );
  eq(
    tombstone.rows[0],
    { cleanup_state: 'deleted', path: file.path },
    'permanent tombstone',
  );
  const recreate = await staff.client.storage
    .from('inventory-files')
    .upload(file.path, png, { contentType: 'image/png' });
  assert.ok(recreate.error, 'deleted source path cannot be reused');
  eq(
    sha(await bytesAt(viewer.client, pdfReady)),
    sha(pdfBytes),
    'photo cleanup preserves PDF bytes',
  );
  const reviewFile = await reserve(
    staff,
    'asset',
    parent,
    3,
    'review.png',
    'image/png',
    png.length,
  );
  const reviewUpload = await staff.client.storage
    .from('inventory-files')
    .upload(reviewFile.path, png, { contentType: 'image/png' });
  assert.equal(reviewUpload.error, null);
  await okay(staff.client, 'inventory_file_uploaded', {
    p_file_id: reviewFile.id,
  });
  const oldRequest = await validate(
    staff,
    keyId,
    secret,
    reviewFile,
    png,
    'image/png',
    parent,
    3,
    'asset_photo',
  );
  const {
    rows: [otherLocation],
  } = await db.query(
    'select id from public.locations where active and can_hold_inventory and id<>$1 limit 1',
    [loc.id],
  );
  const assetVersionBeforeMove = (
    await db.query('select version from public.serialized_assets where id=$1', [
      parent,
    ])
  ).rows[0].version;
  await okay(staff.client, 'asset_move', {
    p_request_id: randomUUID(),
    p_payload: {
      asset_id: parent,
      expected_version: assetVersionBeforeMove,
      location_id: otherLocation.id,
      reason: 'Review race',
    },
  });
  const assetVersionAfterMove = (
    await db.query('select version from public.serialized_assets where id=$1', [
      parent,
    ])
  ).rows[0].version;
  const pdfVersion = (
    await db.query(
      'select version::text from public.inventory_files where id=$1',
      [pdfFile.id],
    )
  ).rows[0].version;
  const renameRequestId = randomUUID();
  const renamePayload = {
    p_file_id: pdfFile.id,
    p_expected_revision: 3,
    p_expected_file_version: pdfVersion,
    p_title: 'Renamed manual',
    p_request_id: renameRequestId,
  };
  const competingRename = {
    ...renamePayload,
    p_title: 'Competing manual title',
    p_request_id: randomUUID(),
  };
  const renameRace = await Promise.all([
    rpc(staff.client, 'inventory_file_rename', renamePayload),
    rpc(independent, 'inventory_file_rename', competingRename),
  ]);
  eq(
    renameRace.filter((entry) => !entry.error).length,
    1,
    'only one independent rename commits against collection revision three',
  );
  eq(
    renameRace.filter((entry) => entry.error?.code === 'P1002').length,
    1,
    'losing rename receives stale collection revision',
  );
  const winnerPayload = renameRace[0].error ? competingRename : renamePayload;
  const renamed = renameRace.find((entry) => !entry.error)!.data;
  eq(
    await okay(staff.client, 'inventory_file_rename', winnerPayload),
    renamed,
    'completed rename receipt replays across collection revision change',
  );
  await denied(
    staff.client,
    'inventory_file_rename',
    { ...winnerPayload, p_title: 'Conflicting rename' },
    'P1009',
  );
  eq(
    (
      await db.query(
        'select version from public.serialized_assets where id=$1',
        [parent],
      )
    ).rows[0].version,
    assetVersionAfterMove,
    'file rename leaves inventory version unchanged after movement',
  );
  eq(
    (
      await okay(viewer.client, 'inventory_file_history', {
        p_parent_type: 'asset',
        p_parent_id: parent,
        p_page: 1,
      })
    ).rows[0].action,
    'renamed',
    'file history contains rename',
  );
  await denied(
    staff.client,
    'inventory_file_finalize',
    {
      p_file_id: reviewFile.id,
      p_expected_revision: 3,
      p_request_id: oldRequest,
    },
    'P1002',
  );
  eq(
    sha(await bytesAt(staff.client, reviewFile.path)),
    sha(png),
    'stale collection retains immutable uploaded bytes',
  );
  await okay(staff.client, 'inventory_file_review', {
    p_file_id: reviewFile.id,
    p_expected_revision: 4,
    p_expected_file_version: null,
  });
  const newRequest = await validate(
    staff,
    keyId,
    secret,
    reviewFile,
    png,
    'image/png',
    parent,
    4,
    'asset_photo',
  );
  const renewed = await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: reviewFile.id,
    p_expected_revision: 4,
    p_request_id: newRequest,
  });
  eq(
    renewed.collection_revision,
    '5',
    'explicit renewed review commits at current collection revision',
  );
  eq(
    (
      await db.query(
        'select validation_generation from public.inventory_files where id=$1',
        [reviewFile.id],
      )
    ).rows[0].validation_generation,
    2,
    'renewed review reinspects under a new generation',
  );

  const races = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      rpc(
        index % 2 === 0 ? staff.client : independent,
        'inventory_file_reserve',
        {
          p_parent_type: 'asset',
          p_parent_id: parent,
          p_expected_revision: 5,
          p_name: `quota-${index}.pdf`,
          p_type: 'application/pdf',
          p_bytes: 1000,
          p_replaces: null,
        },
      ),
    ),
  );
  eq(
    races.filter((entry) => !entry.error).length,
    3,
    'atomic actor pending quota under race',
  );
  eq(
    races.filter((entry) => entry.error?.code === 'P1012').length,
    1,
    'fourth reservation denied',
  );
  for (const entry of races)
    if (entry.data?.id)
      await okay(staff.client, 'inventory_file_cancel', {
        p_file_id: entry.data.id,
      });

  const quantity = await okay(staff.client, 'quantity_create', {
    p_request_id: randomUUID(),
    p_payload: {
      name: 'Recognition test ' + randomUUID(),
      description: null,
      category_id: cat.id,
      manufacturer: null,
      model: null,
      initial_location_id: loc.id,
      initial_quantity: 4,
    },
  });
  const quantityId = quantity.entity_id as string;
  const firstPhoto = await reserve(
    staff,
    'quantity',
    quantityId,
    1,
    'recognition.png',
    'image/png',
    png.length,
  );
  assert.equal(
    (
      await staff.client.storage
        .from('inventory-files')
        .upload(firstPhoto.path, png, { contentType: 'image/png' })
    ).error,
    null,
  );
  await okay(staff.client, 'inventory_file_uploaded', {
    p_file_id: firstPhoto.id,
  });
  const firstRequest = await validate(
    staff,
    keyId,
    secret,
    firstPhoto,
    png,
    'image/png',
    quantityId,
    1,
    'recognition_photo',
    randomUUID(),
    'quantity',
  );
  await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: firstPhoto.id,
    p_expected_revision: 1,
    p_request_id: firstRequest,
  });
  await denied(
    staff.client,
    'inventory_file_reserve',
    {
      p_parent_type: 'quantity',
      p_parent_id: quantityId,
      p_expected_revision: 2,
      p_name: 'duplicate.png',
      p_type: 'image/png',
      p_bytes: png.length,
      p_replaces: null,
    },
    'P1012',
  );
  const replacement = await reserve(
    staff,
    'quantity',
    quantityId,
    2,
    'replacement.png',
    'image/png',
    png.length,
    firstPhoto.id,
  );
  eq(
    (await okay(viewer.client, 'inventory_file_read', {
      p_file_id: firstPhoto.id,
      p_variant: 'display',
    })) !== null,
    true,
    'old recognition photo remains ready during replacement',
  );
  assert.equal(
    (
      await staff.client.storage
        .from('inventory-files')
        .upload(replacement.path, png, { contentType: 'image/png' })
    ).error,
    null,
  );
  await okay(staff.client, 'inventory_file_uploaded', {
    p_file_id: replacement.id,
  });
  const replaceRequest = await validate(
    staff,
    keyId,
    secret,
    replacement,
    png,
    'image/png',
    quantityId,
    2,
    'recognition_photo',
    randomUUID(),
    'quantity',
    firstPhoto.id,
  );
  await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: replacement.id,
    p_expected_revision: 2,
    p_request_id: replaceRequest,
  });
  const quantityState = await db.query(
    "select (select quantity from public.stock_balances where item_id=$1 and location_id=$2) balance, (select count(*) from public.inventory_files where quantity_id=$1 and state='ready') ready, (select count(*) from public.quantity_event_lines l join public.quantity_events e on e.id=l.event_id where e.item_id=$1 and e.kind like 'file_%') file_lines",
    [quantityId, loc.id],
  );
  eq(
    quantityState.rows[0],
    { balance: 4, ready: '1', file_lines: '0' },
    'recognition photo and history leave balances unchanged',
  );
  const quantityThumbnail = await okay(
    viewer.client,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: [],
      p_quantity_ids: [quantityId],
    },
  );
  eq(
    quantityThumbnail[0].photo_count,
    1,
    'quantity list has one recognition photo',
  );
  eq(quantityThumbnail[0].document_count, 0, 'quantity list has no document');
  assert.ok(
    quantityThumbnail[0].thumbnail_path,
    'quantity list has a ready thumbnail',
  );
  checks++;
  await okay(staff.client, 'inventory_file_remove', {
    p_file_id: replacement.id,
    p_expected_revision: 3,
    p_expected_file_version: (
      await db.query(
        'select version::text from public.inventory_files where id=$1',
        [replacement.id],
      )
    ).rows[0].version,
    p_request_id: randomUUID(),
  });
  const removedThumbnail = await okay(
    viewer.client,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: [],
      p_quantity_ids: [quantityId],
    },
  );
  eq(
    removedThumbnail[0].thumbnail_path,
    null,
    'removed recognition path is absent from list',
  );
  eq(
    removedThumbnail[0].photo_count,
    0,
    'removed recognition is absent from ready count',
  );
  await db.query(
    'update public.app_members set active=false where user_id=$1',
    [viewer.id],
  );
  await denied(
    viewer.client,
    'inventory_file_list_thumbnails',
    {
      p_asset_ids: [parent],
      p_quantity_ids: [],
    },
    'P1001',
  );

  const assetBeforeRetire = (
    await db.query('select version from public.serialized_assets where id=$1', [
      parent,
    ])
  ).rows[0].version;
  await okay(staff.client, 'asset_retire', {
    p_request_id: randomUUID(),
    p_payload: {
      asset_id: parent,
      expected_version: assetBeforeRetire,
      reason: 'Retained file management test',
    },
  });
  const retiredVersion = (
    await db.query('select version from public.serialized_assets where id=$1', [
      parent,
    ])
  ).rows[0].version;
  eq(
    (
      await okay(staff.client, 'inventory_file_cards', {
        p_parent_type: 'asset',
        p_parent_id: parent,
      })
    ).revision,
    '5',
    'retired asset retains its readable file collection',
  );
  const isolation = new Client({
    connectionString: dbUrl,
    application_name: 'files-repeatable-read',
  });
  await isolation.connect();
  await isolation.query('begin isolation level repeatable read');
  await isolation.query('set local role authenticated');
  await isolation.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: staff.id, role: 'authenticated' }),
  ]);
  await isolation.query(
    'select public.inventory_file_cards($1::text,$2::uuid)',
    ['asset', parent],
  );
  const retiredAttachment = await reserve(
    staff,
    'asset',
    parent,
    5,
    'retired.pdf',
    'application/pdf',
    1000,
  );
  try {
    eq(
      (
        await isolation.query(
          'select public.inventory_file_finalize($1::uuid,$2::bigint,$3::uuid) as result',
          [file.id, 1, requestId],
        )
      ).rows[0].result,
      finalized,
      'completed receipt replays under an old authorized snapshot before fresh-state guards',
    );
    await assert.rejects(
      isolation.query('select public.inventory_file_cancel($1::uuid)', [
        retiredAttachment.id,
      ]),
      { code: 'P1016' },
    );
    checks++;
  } finally {
    await isolation.query('rollback');
    await isolation.end();
  }
  const serializable = new Client({
    connectionString: dbUrl,
    application_name: 'files-serializable',
  });
  await serializable.connect();
  try {
    await serializable.query('begin isolation level serializable');
    await serializable.query('set local role authenticated');
    await serializable.query(
      "select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify({ sub: staff.id, role: 'authenticated' })],
    );
    await assert.rejects(
      serializable.query('select public.inventory_file_cancel($1::uuid)', [
        retiredAttachment.id,
      ]),
      { code: 'P1016' },
    );
    checks++;
  } finally {
    await serializable.query('rollback');
    await serializable.end();
  }
  await okay(staff.client, 'inventory_file_cancel', {
    p_file_id: retiredAttachment.id,
  });
  // The quota-race reservations above deliberately leave their full source
  // allowance charged after cancellation. Drain only this test's fictional
  // parents through the signed cleanup lifecycle before the E2E fixtures run.
  const quotaFiles = [
    ...races.filter((entry) => entry.data?.id).map((entry) => entry.data.id),
    retiredAttachment.id,
  ];
  const quotaObjects = await db.query<{ id: string }>(
    `select id from private.file_objects
      where file_id=any($1::uuid[]) and cleanup_state='eligible'`,
    [quotaFiles],
  );
  eq(
    quotaObjects.rows.length,
    4,
    'four cancelled fixture objects need cleanup',
  );
  const remainingQuotaObjects = new Set(quotaObjects.rows.map((row) => row.id));
  for (let batch = 0; remainingQuotaObjects.size > 0 && batch < 4; batch++) {
    const claims = (await okay(staff.client, 'inventory_file_cleanup_claim', {
      p_limit: 20,
      p_key_id: keyId,
      ...serverProof(secret, staff.id, 'cleanup_claim', ['20', keyId]),
    })) as { object_id: string; path: string }[];
    assert.ok(claims.length > 0, 'fixture cleanup must make progress');
    const owned = await db.query<{ id: string }>(
      `select o.id from private.file_objects o
        join public.inventory_files f on f.id=o.file_id
       where o.id=any($1::uuid[])
         and (f.asset_id=$2 or f.quantity_id=$3)`,
      [claims.map((claim) => claim.object_id), parent, quantityId],
    );
    eq(
      owned.rows.length,
      claims.length,
      "cleanup claim contains only this test's fictional parents",
    );
    for (const claim of claims) {
      const present = await db.query<{ present: boolean }>(
        "select exists(select 1 from storage.objects where bucket_id='inventory-files' and name=$1) present",
        [claim.path],
      );
      if (present.rows[0].present) {
        const deletion = await staff.client.storage
          .from('inventory-files')
          .remove([claim.path]);
        assert.equal(
          deletion.error,
          null,
          'fictional cleanup Storage deletion',
        );
      }
      await okay(staff.client, 'inventory_file_cleanup_confirm', {
        p_object_id: claim.object_id,
        p_key_id: keyId,
        ...serverProof(secret, staff.id, 'cleanup_confirm', [
          claim.object_id,
          keyId,
        ]),
      });
      remainingQuotaObjects.delete(claim.object_id);
    }
  }
  eq(
    remainingQuotaObjects.size,
    0,
    'cancelled quota fixtures are absent and no longer charged',
  );
  eq(
    (
      await db.query(
        'select version from public.serialized_assets where id=$1',
        [parent],
      )
    ).rows[0].version,
    retiredVersion,
    'retired asset attachment management does not change inventory version',
  );

  await db.query(
    "update private.file_keys set accepts_new=false,verify_until=now()-interval '1 minute' where key_id=$1",
    [keyId],
  );
  const rotatedReplay = await okay(staff.client, 'inventory_file_finalize', {
    p_file_id: file.id,
    p_expected_revision: 1,
    p_request_id: requestId,
  });
  eq(rotatedReplay, finalized, 'receipt replay survives key retirement');
  console.log(
    `Private files real Storage and RPC checks passed (${checks} assertions).`,
  );
}

main()
  .catch((error) => {
    mainFailed = true;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (mainFailed && keyToRetire && keySecretForCleanup && actors[0]) {
        try {
          await cleanupFailedFixture(
            actors[0],
            keyToRetire,
            keySecretForCleanup,
          );
        } catch (error) {
          console.error(
            'Fictional Files fixture cleanup also failed:',
            (error as { code?: string }).code ?? 'unknown',
          );
        }
      }
      if (keyToRetire) {
        await db.query(
          'update private.file_keys set accepts_new=false,verify_until=clock_timestamp(),secret=$2 where key_id=$1',
          [keyToRetire, randomBytes(48).toString('hex')],
        );
      }
    } finally {
      await Promise.allSettled(
        actors.map((person) => person.client.auth.signOut({ scope: 'local' })),
      );
      await db.end();
    }
  });
