import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import authFixture from '../fixtures/auth.json' with { type: 'json' };

const operations = [
  'quantity_create',
  'quantity_receive',
  'quantity_move',
  'quantity_adjust',
  'quantity_update',
  'quantity_archive',
  'quantity_archive_and_clear',
  'quantity_restore',
  'asset_create',
  'asset_move',
  'asset_correct_location',
  'asset_update',
  'asset_retire',
  'asset_restore',
] as const;
type Operation = (typeof operations)[number];
type Payload = Record<string, unknown>;
type Mutation = {
  entity_id: string;
  version: number;
  event_id: string | null;
  changed: boolean;
};
type ArchiveClearResult = {
  entity_id: string;
  version: string;
  event_id: string;
  changed: true;
  removed_total: string;
  location_deltas: {
    location_id: string;
    before: number;
    delta: number;
    after: number;
  }[];
};
type Actor = { id: string; client: SupabaseClient; name: string };
type SearchRow = {
  entity_id: string;
  kind: string;
  location_id: string | null;
  location_code: string | null;
  breadcrumb: string | null;
  quantity: number | null;
  status: string;
  serial_number: string | null;
};
type ReadPage = { rows: SearchRow[]; total: number };

function local(value: string | undefined, port: number) {
  assert.ok(value, 'local test configuration must be present');
  const parsed = new URL(value);
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname),
    'refusing a nonlocal test target',
  );
  assert.equal(
    Number(parsed.port),
    port,
    'refusing an unexpected local service',
  );
  return value;
}
const apiUrl = local(process.env.LOCAL_API_URL, 54321);
const dbUrl = local(process.env.LOCAL_DB_URL, 54322);
assert.ok(process.env.LOCAL_ANON_KEY, 'local public key required');
assert.ok(
  process.env.LOCAL_SERVICE_ROLE_KEY,
  'local fixture administration key required',
);
const sessionOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};
const publicClient = () =>
  createClient(apiUrl, process.env.LOCAL_ANON_KEY!, sessionOptions);
const admin = createClient(
  apiUrl,
  process.env.LOCAL_SERVICE_ROLE_KEY!,
  sessionOptions,
);
const owner = new Client({
  connectionString: dbUrl,
  application_name: 'inventory-integration-owner',
});
const actors: Actor[] = [];
const prefix = 'Integration-' + randomUUID();
let assertions = 0;

async function invoke(
  client: SupabaseClient,
  operation: Operation,
  payload: Payload,
  requestId = randomUUID(),
) {
  return client.rpc(operation, { p_request_id: requestId, p_payload: payload });
}
async function succeed(
  client: SupabaseClient,
  operation: Operation,
  payload: Payload,
  requestId = randomUUID(),
): Promise<Mutation> {
  const { data, error } = await invoke(client, operation, payload, requestId);
  assert.equal(
    error,
    null,
    operation + ' failed: ' + error?.code + ' ' + error?.message,
  );
  assert.ok(data && typeof data === 'object');
  assert.equal(typeof data.entity_id, 'string');
  assert.ok(Number.isInteger(data.version) && data.version > 0);
  assert.equal(typeof data.changed, 'boolean');
  assert.ok(data.event_id === null || typeof data.event_id === 'string');
  assertions++;
  return data as Mutation;
}
async function fail(
  client: SupabaseClient,
  operation: Operation,
  payload: Payload,
  code: string,
  requestId = randomUUID(),
) {
  const { data, error } = await invoke(client, operation, payload, requestId);
  assert.equal(
    error?.code,
    code,
    operation + ' must reject with ' + code + ': ' + error?.message,
  );
  assert.equal(data, null, 'failed mutations do not return successful state');
  assertions++;
}
async function archiveClear(
  client: SupabaseClient,
  payload: Payload,
  requestId = randomUUID(),
): Promise<ArchiveClearResult> {
  const { data, error } = await invoke(
    client,
    'quantity_archive_and_clear',
    payload,
    requestId,
  );
  assert.equal(error, null, error?.message);
  assert.match(data.version, /^[1-9][0-9]*$/);
  assert.match(data.removed_total, /^(0|[1-9][0-9]*)$/);
  assert.equal(data.changed, true);
  assert.ok(Array.isArray(data.location_deltas));
  assertions++;
  return data as ArchiveClearResult;
}
async function actor(
  kind: 'staff' | 'viewer' | 'inactive' | 'nonmember',
): Promise<Actor> {
  const email = kind + '-' + randomUUID() + '@example.test';
  const created = await admin.auth.admin.createUser({
    email,
    password: authFixture.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const name = prefix + ' ' + kind;
  if (kind !== 'nonmember') {
    await owner.query(
      'insert into public.app_members(user_id,display_name,role,active) values($1,$2,$3,$4)',
      [id, name, kind === 'viewer' ? 'viewer' : 'staff', kind !== 'inactive'],
    );
  }
  const client = publicClient();
  const signedIn = await client.auth.signInWithPassword({
    email,
    password: authFixture.password,
  });
  if (signedIn.error) throw signedIn.error;
  const result = { id, client, name };
  actors.push(result);
  return result;
}
async function count(sql: string, parameters: unknown[] = []) {
  const result = await owner.query(sql, parameters);
  return Number(result.rows[0].count);
}
async function quantitySnapshot(id: string) {
  const item = await owner.query(
    'select * from public.quantity_items where id=$1',
    [id],
  );
  const balances = await owner.query(
    'select location_id,quantity from public.stock_balances where item_id=$1 order by location_id',
    [id],
  );
  const events = await owner.query(
    'select * from public.quantity_events where item_id=$1 order by version',
    [id],
  );
  const lines = await owner.query(
    'select l.* from public.quantity_event_lines l join public.quantity_events e on e.id=l.event_id where e.item_id=$1 order by e.version,l.location_id',
    [id],
  );
  return {
    item: item.rows[0],
    balances: balances.rows,
    events: events.rows,
    lines: lines.rows,
  };
}
async function assetSnapshot(id: string) {
  const item = await owner.query(
    'select * from public.serialized_assets where id=$1',
    [id],
  );
  const events = await owner.query(
    'select * from public.asset_events where asset_id=$1 order by version',
    [id],
  );
  return { item: item.rows[0], events: events.rows };
}
async function receipt(actorId: string, requestId: string) {
  const result = await owner.query(
    'select operation,request_payload,result from private.mutation_requests where actor_id=$1 and request_id=$2',
    [actorId, requestId],
  );
  return result.rows;
}
async function search(
  client: SupabaseClient,
  parameters: Payload,
): Promise<ReadPage> {
  const result = await client.rpc('inventory_search', parameters);
  if (result.error) throw result.error;
  assert.ok(Array.isArray(result.data.rows));
  assert.equal(typeof result.data.total, 'number');
  return result.data as ReadPage;
}

// Explicit row locks keep both requests in flight, rather than hoping scheduling overlaps.
async function concurrent<T, U>(
  staff: Actor,
  itemId: string,
  first: () => PromiseLike<T>,
  second: () => PromiseLike<U>,
): Promise<[T, U]> {
  const blocker = new Client({
    connectionString: dbUrl,
    application_name: 'inventory-integration-blocker',
  });
  await blocker.connect();
  let pending: Promise<[T, U]> | undefined;
  try {
    await blocker.query('begin');
    await blocker.query(
      'select id from public.quantity_items where id=$1 for update',
      [itemId],
    );
    pending = Promise.all([first(), second()]);
    const deadline = Date.now() + 10_000;
    let blocked = 0;
    while (Date.now() < deadline) {
      blocked = await count(
        "select count(*) from pg_stat_activity where datname=current_database() and state='active' and wait_event_type='Lock' and query like '%quantity_%' and pid<>pg_backend_pid()",
      );
      if (blocked >= 2) break;
      await delay(25);
    }
    assert.ok(
      blocked >= 2,
      'both RPCs must be concurrently blocked before release for ' + staff.id,
    );
    await blocker.query('commit');
    return await pending;
  } finally {
    await blocker.query('rollback');
    await blocker.end();
    if (pending) await Promise.allSettled([pending]);
  }
}

async function main() {
  await owner.connect();
  // Fixture membership writes share one owner connection and must be sequential.
  const staff = await actor('staff');
  const otherStaff = await actor('staff');
  const viewer = await actor('viewer');
  const inactive = await actor('inactive');
  const nonmember = await actor('nonmember');
  const categories = await owner.query(
    "select id,code from public.categories where code in ('CABLES','COMPUTERS')",
  );
  const category = (code: string): string => {
    const found = categories.rows.find((row) => row.code === code);
    assert.ok(found, 'required category ' + code);
    return found.id;
  };
  const locations = await owner.query(
    "select id,code,active,can_hold_inventory from public.locations where code in ('ITC-S1A','ITC-S1B','ITC-D01','ITC-L')",
  );
  const location = (code: string): string => {
    const found = locations.rows.find((row) => row.code === code);
    assert.ok(found, 'required location ' + code);
    return found.id;
  };
  const a = location('ITC-S1A'),
    b = location('ITC-S1B'),
    c = location('ITC-D01');
  const metadata = { name: prefix + ' cable', category_id: category('CABLES') };
  const assetMetadata = {
    name: prefix + ' laptop',
    category_id: category('COMPUTERS'),
  };

  // Every denied role is checked against every mutation, even with malformed payloads.
  for (const denied of [viewer, inactive, nonmember]) {
    for (const operation of operations)
      await fail(denied.client, operation, {}, 'P1001');
  }
  const anon = publicClient();
  for (const operation of operations) await fail(anon, operation, {}, '42501');

  const creationRequest = randomUUID();
  const zero = await succeed(
    staff.client,
    'quantity_create',
    metadata,
    creationRequest,
  );
  assert.equal(zero.version, 1);
  assert.equal((await quantitySnapshot(zero.entity_id)).balances.length, 0);
  const normalizedReplay = await succeed(
    staff.client,
    'quantity_create',
    {
      model: null,
      manufacturer: ' ',
      initial_quantity: 0,
      initial_location_id: null,
      description: '',
      category_id: metadata.category_id,
      name: '  ' + metadata.name + '  ',
    },
    creationRequest,
  );
  assert.deepEqual(
    normalizedReplay,
    zero,
    'normalized payload replay is exact',
  );
  await fail(
    staff.client,
    'quantity_create',
    { ...metadata, name: metadata.name + ' changed' },
    'P1009',
    creationRequest,
  );
  await fail(
    staff.client,
    'asset_create',
    { ...assetMetadata, location_id: a },
    'P1009',
    creationRequest,
  );
  const independentActor = await succeed(
    otherStaff.client,
    'quantity_create',
    metadata,
    creationRequest,
  );
  assert.notEqual(
    independentActor.entity_id,
    zero.entity_id,
    'request IDs are scoped by actor',
  );
  assert.equal((await receipt(staff.id, creationRequest)).length, 1);
  const zeroBefore = await quantitySnapshot(zero.entity_id);
  const noStockChange = await succeed(staff.client, 'quantity_adjust', {
    item_id: zero.entity_id,
    expected_version: 1,
    location_id: a,
    observed_quantity: 0,
    reason: 'Confirmed no stock at this location',
  });
  assert.equal(noStockChange.changed, false);
  assert.equal(noStockChange.version, 1);
  assert.equal(noStockChange.event_id, null);
  assert.deepEqual(await quantitySnapshot(zero.entity_id), zeroBefore);
  await fail(
    staff.client,
    'quantity_create',
    { ...metadata, initial_quantity: 1 },
    'P1012',
  );
  const zeroWithLocation = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    initial_quantity: 0,
    initial_location_id: a,
  });
  assert.equal(zeroWithLocation.version, 1);
  const zeroWithLocationState = await quantitySnapshot(
    zeroWithLocation.entity_id,
  );
  assert.deepEqual(zeroWithLocationState.balances, []);
  assert.deepEqual(zeroWithLocationState.lines, []);

  const stock = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' stocked',
    initial_quantity: 10,
    initial_location_id: a,
  });
  let version = stock.version;
  const itemId = stock.entity_id;
  const base = () => ({ item_id: itemId, expected_version: version });
  const advanced = (result: Mutation) => {
    assert.equal(
      result.version,
      version + 1,
      'changed operation increments exactly once',
    );
    assert.equal(result.changed, true);
    assert.ok(result.event_id);
    version = result.version;
    return result;
  };
  const received = advanced(
    await succeed(staff.client, 'quantity_receive', {
      ...base(),
      location_id: b,
      quantity: 5,
      reason: 'Delivered stock',
    }),
  );
  let snapshot = await quantitySnapshot(itemId);
  assert.deepEqual(
    snapshot.balances.map((row) => row.quantity).sort((x, y) => x - y),
    [5, 10],
  );
  assert.equal(snapshot.events.at(-1).kind, 'received');
  assert.equal(snapshot.events.at(-1).actor_id, staff.id);
  assert.equal(snapshot.events.at(-1).actor_name, staff.name);
  assert.equal(snapshot.events.at(-1).reason, 'Delivered stock');
  assert.equal(
    snapshot.lines.find((line) => line.event_id === received.event_id).delta,
    5,
  );

  const partial = advanced(
    await succeed(staff.client, 'quantity_move', {
      ...base(),
      source_location_id: a,
      destination_location_id: b,
      quantity: 4,
    }),
  );
  snapshot = await quantitySnapshot(itemId);
  const moveLines = snapshot.lines.filter(
    (line) => line.event_id === partial.event_id,
  );
  assert.equal(moveLines.length, 2);
  assert.equal(
    moveLines.reduce((sum, line) => sum + line.delta, 0),
    0,
    'transfer conserves stock',
  );
  assert.equal(
    snapshot.balances.find((row) => row.location_id === a).quantity,
    6,
  );
  assert.equal(
    snapshot.balances.find((row) => row.location_id === b).quantity,
    9,
  );

  advanced(
    await succeed(staff.client, 'quantity_receive', {
      ...base(),
      location_id: c,
      quantity: 3,
      reason: 'Third location stock',
    }),
  );
  advanced(
    await succeed(staff.client, 'quantity_move', {
      ...base(),
      source_location_id: a,
      destination_location_id: b,
      move_all: true,
    }),
  );
  snapshot = await quantitySnapshot(itemId);
  assert.equal(
    snapshot.balances.find((row) => row.location_id === a).quantity,
    0,
  );
  assert.equal(
    snapshot.balances.find((row) => row.location_id === b).quantity,
    15,
  );
  assert.equal(
    snapshot.balances.find((row) => row.location_id === c).quantity,
    3,
    'Move All is scoped to its source balance',
  );

  const correction = advanced(
    await succeed(staff.client, 'quantity_adjust', {
      ...base(),
      location_id: b,
      observed_quantity: 11,
      reason: 'Physical recount',
    }),
  );
  snapshot = await quantitySnapshot(itemId);
  const correctedLine = snapshot.lines.find(
    (line) => line.event_id === correction.event_id,
  );
  assert.deepEqual(
    [
      correctedLine.before_quantity,
      correctedLine.after_quantity,
      correctedLine.delta,
    ],
    [15, 11, -4],
  );
  const noChangeRequest = randomUUID();
  const noChangePayload = {
    ...base(),
    location_id: b,
    observed_quantity: 11,
    reason: 'Confirmed count',
  };
  const noChange = await succeed(
    staff.client,
    'quantity_adjust',
    noChangePayload,
    noChangeRequest,
  );
  assert.deepEqual(noChange, {
    entity_id: itemId,
    version,
    event_id: null,
    changed: false,
  });
  assert.deepEqual(
    await quantitySnapshot(itemId),
    snapshot,
    'no-change correction does not invent history',
  );
  assert.deepEqual(
    (await receipt(staff.id, noChangeRequest))[0].result,
    noChange,
  );
  assert.deepEqual(
    await succeed(
      staff.client,
      'quantity_adjust',
      noChangePayload,
      noChangeRequest,
    ),
    noChange,
  );

  for (const quantity of [-1, 0, 1.5, 2147483648, '1', null]) {
    await fail(
      staff.client,
      'quantity_receive',
      { ...base(), location_id: a, quantity, reason: 'Invalid count' },
      'P1006',
    );
  }
  await fail(
    staff.client,
    'quantity_adjust',
    { ...base(), location_id: b, observed_quantity: -1, reason: 'Invalid' },
    'P1006',
  );
  await fail(
    staff.client,
    'quantity_adjust',
    { ...base(), location_id: b, observed_quantity: 1.1, reason: 'Invalid' },
    'P1006',
  );
  await fail(
    staff.client,
    'quantity_receive',
    { ...base(), location_id: a, quantity: 1 },
    'P1012',
  );
  await fail(
    staff.client,
    'quantity_move',
    {
      ...base(),
      source_location_id: b,
      destination_location_id: a,
      quantity: 12,
    },
    'P1003',
  );
  await fail(
    staff.client,
    'quantity_move',
    {
      ...base(),
      source_location_id: a,
      destination_location_id: b,
      move_all: true,
    },
    'P1003',
  );
  await fail(
    staff.client,
    'quantity_move',
    {
      ...base(),
      source_location_id: b,
      destination_location_id: b,
      quantity: 1,
    },
    'P1005',
  );
  await fail(
    staff.client,
    'quantity_move',
    {
      ...base(),
      source_location_id: b,
      destination_location_id: a,
      move_all: true,
      quantity: 1,
    },
    'P1012',
  );
  await fail(
    staff.client,
    'quantity_receive',
    {
      ...base(),
      expected_version: version - 1,
      location_id: a,
      quantity: 1,
      reason: 'Stale',
    },
    'P1002',
  );
  await fail(
    staff.client,
    'quantity_receive',
    {
      ...base(),
      item_id: randomUUID(),
      location_id: a,
      quantity: 1,
      reason: 'Missing',
    },
    'P1010',
  );
  for (const destination of [location('ITC-L'), randomUUID()]) {
    await fail(
      staff.client,
      'quantity_receive',
      {
        ...base(),
        location_id: destination,
        quantity: 1,
        reason: 'Invalid destination',
      },
      'P1004',
    );
  }
  const oldLocation = locations.rows.find((row) => row.id === c)!;
  try {
    await owner.query('update public.locations set active=false where id=$1', [
      c,
    ]);
    await fail(
      staff.client,
      'quantity_receive',
      { ...base(), location_id: c, quantity: 1, reason: 'Inactive' },
      'P1004',
    );
    await owner.query(
      'update public.locations set active=true,can_hold_inventory=false where id=$1',
      [c],
    );
    await fail(
      staff.client,
      'quantity_receive',
      {
        ...base(),
        location_id: c,
        quantity: 1,
        reason: 'Not inventory-bearing',
      },
      'P1004',
    );
  } finally {
    await owner.query(
      'update public.locations set active=$2,can_hold_inventory=$3 where id=$1',
      [c, oldLocation.active, oldLocation.can_hold_inventory],
    );
  }
  assert.deepEqual(
    await quantitySnapshot(itemId),
    snapshot,
    'invalid operations leave all current state and history untouched',
  );

  const failedRequest = randomUUID();
  await fail(
    staff.client,
    'quantity_receive',
    {
      ...base(),
      location_id: randomUUID(),
      quantity: 1,
      reason: 'Rejected destination',
    },
    'P1004',
    failedRequest,
  );
  assert.deepEqual(
    await receipt(staff.id, failedRequest),
    [],
    'failed transactions retain no receipt',
  );
  advanced(
    await succeed(
      staff.client,
      'quantity_receive',
      {
        ...base(),
        location_id: a,
        quantity: 1,
        reason: 'Corrected destination',
      },
      failedRequest,
    ),
  );

  const maxStock = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' maximum',
    initial_location_id: a,
    initial_quantity: 2147483647,
  });
  const maxBefore = await quantitySnapshot(maxStock.entity_id);
  await fail(
    staff.client,
    'quantity_receive',
    {
      item_id: maxStock.entity_id,
      expected_version: 1,
      location_id: a,
      quantity: 1,
      reason: 'Overflow',
    },
    'P1006',
  );
  assert.deepEqual(await quantitySnapshot(maxStock.entity_id), maxBefore);

  const updated = advanced(
    await succeed(staff.client, 'quantity_update', {
      ...base(),
      ...metadata,
      name: prefix + ' renamed',
      description: 'Corrected model detail',
      manufacturer: 'Example',
      model: 'M-01',
    }),
  );
  snapshot = await quantitySnapshot(itemId);
  const editEvent = snapshot.events.find(
    (event) => event.id === updated.event_id,
  );
  assert.equal(editEvent.before_metadata.name, prefix + ' stocked');
  assert.equal(editEvent.after_metadata.name, prefix + ' renamed');
  await fail(
    staff.client,
    'quantity_update',
    { ...base(), ...metadata, actor_id: otherStaff.id },
    'P1012',
  );
  await fail(
    staff.client,
    'quantity_update',
    { ...base(), ...metadata, category_id: randomUUID() },
    'P1011',
  );
  await fail(
    staff.client,
    'quantity_archive',
    { ...base(), reason: 'Still stocked' },
    'P1008',
  );
  for (const row of snapshot.balances.filter((row) => row.quantity > 0)) {
    advanced(
      await succeed(staff.client, 'quantity_adjust', {
        ...base(),
        location_id: row.location_id,
        observed_quantity: 0,
        reason: 'No longer held',
      }),
    );
  }
  const legacyArchivePayload = { ...base(), reason: 'Definition retired' };
  const legacyArchiveRequest = randomUUID();
  const legacyArchive = advanced(
    await succeed(
      staff.client,
      'quantity_archive',
      legacyArchivePayload,
      legacyArchiveRequest,
    ),
  );
  assert.equal((await quantitySnapshot(itemId)).item.archived, true);
  await fail(
    staff.client,
    'quantity_receive',
    { ...base(), location_id: a, quantity: 1, reason: 'Archived' },
    'P1008',
  );
  await fail(
    staff.client,
    'quantity_update',
    { ...base(), ...metadata },
    'P1008',
  );
  advanced(
    await succeed(staff.client, 'quantity_restore', {
      ...base(),
      reason: 'Definition needed again',
    }),
  );
  snapshot = await quantitySnapshot(itemId);
  assert.equal(snapshot.item.archived, false);
  assert.ok(snapshot.balances.every((row) => row.quantity === 0));
  assert.deepEqual(
    await succeed(
      staff.client,
      'quantity_archive',
      legacyArchivePayload,
      legacyArchiveRequest,
    ),
    legacyArchive,
    'an old successful archive receipt replays even after restore',
  );
  assert.deepEqual(
    snapshot.events.map((event) => event.version),
    Array.from({ length: version }, (_, index) => index + 1),
  );

  // The opt-in operation keeps the legacy archive's positive-stock rejection,
  // but clears every reviewed balance in one event and one version increment.
  const clearItem = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' archive clear',
    initial_location_id: a,
    initial_quantity: 8,
    reorder_threshold: 5,
  });
  await succeed(staff.client, 'quantity_receive', {
    item_id: clearItem.entity_id,
    expected_version: 1,
    location_id: b,
    quantity: 4,
    reason: 'Additional stock',
  });
  const clearPayload = {
    item_id: clearItem.entity_id,
    expected_version: '2',
    confirm_clear_stock: true,
    reason: 'Removed obsolete stock',
  };
  await owner.query('update public.locations set active=false where id=$1', [
    b,
  ]);
  try {
    const review = await viewer.client.rpc('quantity_archive_review', {
      p_item_id: clearItem.entity_id,
    });
    assert.equal(review.error, null);
    assert.equal(review.data.version, '2');
    assert.equal(review.data.removed_total, '12');
    assert.deepEqual(
      review.data.locations
        .map((row: { quantity: number }) => row.quantity)
        .sort(),
      [4, 8],
    );
    assert.equal(
      review.data.locations.find(
        (row: { location_id: string }) => row.location_id === b,
      ).active,
      false,
    );
    assert.equal(
      (
        await anon.rpc('quantity_archive_review', {
          p_item_id: clearItem.entity_id,
        })
      ).error?.code,
      '42501',
    );
    await fail(
      staff.client,
      'quantity_archive',
      {
        item_id: clearItem.entity_id,
        expected_version: 2,
        reason: 'Old-client attempt',
      },
      'P1008',
    );
    const beforeInvalidConfirmation = await quantitySnapshot(
      clearItem.entity_id,
    );
    for (const confirmation of [undefined, null, false, 'true']) {
      const invalid: Payload = { ...clearPayload };
      if (confirmation === undefined) delete invalid.confirm_clear_stock;
      else invalid.confirm_clear_stock = confirmation;
      const deniedRequest = randomUUID();
      await fail(
        staff.client,
        'quantity_archive_and_clear',
        invalid,
        'P1012',
        deniedRequest,
      );
      assert.deepEqual(
        await quantitySnapshot(clearItem.entity_id),
        beforeInvalidConfirmation,
        'invalid confirmation cannot change state or history',
      );
      assert.deepEqual(
        await receipt(staff.id, deniedRequest),
        [],
        'invalid confirmation cannot commit a receipt',
      );
    }
    await fail(
      staff.client,
      'quantity_archive_and_clear',
      {
        ...clearPayload,
        expected_version: '1',
      },
      'P1002',
    );
    const clearRequest = randomUUID();
    const cleared = await archiveClear(
      staff.client,
      clearPayload,
      clearRequest,
    );
    assert.equal(cleared.version, '3');
    assert.equal(cleared.removed_total, '12');
    assert.deepEqual(
      cleared.location_deltas
        .map((line) => [line.before, line.delta, line.after])
        .sort(),
      [
        [4, -4, 0],
        [8, -8, 0],
      ],
    );
    const afterClear = await quantitySnapshot(clearItem.entity_id);
    assert.equal(afterClear.item.archived, true);
    assert.equal(afterClear.item.version, 3);
    assert.equal(afterClear.item.reorder_threshold, 5);
    assert.deepEqual(
      afterClear.balances.map((row) => row.quantity),
      [0, 0],
    );
    const archiveEvent = afterClear.events.find(
      (event) => event.id === cleared.event_id,
    );
    assert.equal(archiveEvent.kind, 'archived');
    assert.equal(archiveEvent.reason, clearPayload.reason);
    assert.equal(
      afterClear.lines.filter((line) => line.event_id === cleared.event_id)
        .length,
      2,
    );
    assert.deepEqual(
      await archiveClear(
        staff.client,
        {
          ...clearPayload,
          expected_version: 2,
          reason: ' Removed obsolete stock ',
        },
        clearRequest,
      ),
      cleared,
      'normalized successful replay returns the original result',
    );
    await fail(
      staff.client,
      'quantity_archive_and_clear',
      {
        ...clearPayload,
        reason: 'Different reason',
      },
      'P1009',
      clearRequest,
    );
    await fail(
      staff.client,
      'quantity_archive_and_clear',
      clearPayload,
      'P1002',
    );
    const restoredClear = await succeed(staff.client, 'quantity_restore', {
      item_id: clearItem.entity_id,
      expected_version: 3,
      reason: 'Definition needed again',
    });
    assert.equal(restoredClear.version, 4);
    assert.equal(
      (await quantitySnapshot(clearItem.entity_id)).item.reorder_threshold,
      5,
    );
    assert.ok(
      (await quantitySnapshot(clearItem.entity_id)).balances.every(
        (row) => row.quantity === 0,
      ),
    );
    const activeSearch = await staff.client.rpc('inventory_search_v2', {
      p_query: prefix + ' archive clear',
    });
    assert.equal(activeSearch.error, null);
    assert.ok(
      activeSearch.data.rows.every(
        (row: { quantity: number | null }) => row.quantity === null,
      ),
    );
  } finally {
    await owner.query('update public.locations set active=true where id=$1', [
      b,
    ]);
  }

  const alreadyZero = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' archive zero',
    reorder_threshold: 3,
  });
  const zeroPayload = {
    item_id: alreadyZero.entity_id,
    expected_version: '1',
    confirm_clear_stock: true,
    reason: 'Retire unused definition',
  };
  const zeroRequest = randomUUID();
  const zeroArchive = await archiveClear(
    staff.client,
    zeroPayload,
    zeroRequest,
  );
  assert.equal(zeroArchive.removed_total, '0');
  assert.deepEqual(zeroArchive.location_deltas, []);
  await fail(
    staff.client,
    'quantity_archive_and_clear',
    {
      ...zeroPayload,
      expected_version: '2',
    },
    'P1008',
  );
  assert.deepEqual(
    await archiveClear(staff.client, zeroPayload, zeroRequest),
    zeroArchive,
  );

  const largeStock = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' archive bigint total',
    initial_location_id: a,
    initial_quantity: 2147483647,
  });
  await succeed(staff.client, 'quantity_receive', {
    item_id: largeStock.entity_id,
    expected_version: 1,
    location_id: b,
    quantity: 2147483647,
    reason: 'Large second balance',
  });
  const largeArchive = await archiveClear(staff.client, {
    item_id: largeStock.entity_id,
    expected_version: '2',
    confirm_clear_stock: true,
    reason: 'Remove both large balances',
  });
  assert.equal(largeArchive.removed_total, '4294967294');
  assert.ok(
    (await quantitySnapshot(largeStock.entity_id)).balances.every(
      (row) => row.quantity === 0,
    ),
  );

  const competing = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' archive race',
    initial_location_id: a,
    initial_quantity: 5,
  });
  const [archiveRace, receiveRace] = await concurrent(
    staff,
    competing.entity_id,
    () =>
      invoke(staff.client, 'quantity_archive_and_clear', {
        item_id: competing.entity_id,
        expected_version: '1',
        confirm_clear_stock: true,
        reason: 'Concurrent archive',
      }),
    () =>
      invoke(otherStaff.client, 'quantity_receive', {
        item_id: competing.entity_id,
        expected_version: 1,
        location_id: b,
        quantity: 1,
        reason: 'Concurrent receive',
      }),
  );
  assert.equal([archiveRace, receiveRace].filter((r) => !r.error).length, 1);
  assert.equal(
    [archiveRace, receiveRace].filter((r) => r.error?.code === 'P1002').length,
    1,
  );
  const raceSnapshot = await quantitySnapshot(competing.entity_id);
  assert.equal(raceSnapshot.item.version, 2);
  assert.equal(raceSnapshot.events.length, 2);
  assert.equal(raceSnapshot.item.archived, !archiveRace.error);

  const duplicate = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' archive duplicate',
    initial_location_id: a,
    initial_quantity: 6,
  });
  const duplicateRequest = randomUUID();
  const duplicatePayload = {
    item_id: duplicate.entity_id,
    expected_version: '1',
    confirm_clear_stock: true,
    reason: 'Duplicate archive submission',
  };
  const [firstArchive, secondArchive] = await concurrent(
    staff,
    duplicate.entity_id,
    () =>
      invoke(
        staff.client,
        'quantity_archive_and_clear',
        duplicatePayload,
        duplicateRequest,
      ),
    () =>
      invoke(
        staff.client,
        'quantity_archive_and_clear',
        duplicatePayload,
        duplicateRequest,
      ),
  );
  assert.equal(firstArchive.error, null);
  assert.equal(secondArchive.error, null);
  assert.deepEqual(firstArchive.data, secondArchive.data);
  assert.equal((await quantitySnapshot(duplicate.entity_id)).events.length, 2);

  // Replay must return the original creation result even after current state advances.
  await succeed(staff.client, 'quantity_receive', {
    item_id: zero.entity_id,
    expected_version: 1,
    location_id: a,
    quantity: 2,
    reason: 'After original receipt',
  });
  assert.deepEqual(
    await succeed(staff.client, 'quantity_create', metadata, creationRequest),
    zero,
  );
  await owner.query(
    'update public.app_members set active=false where user_id=$1',
    [staff.id],
  );
  try {
    await fail(
      staff.client,
      'quantity_create',
      metadata,
      'P1001',
      creationRequest,
    );
    const hidden = await staff.client.from('quantity_items').select('id');
    assert.equal(hidden.error, null);
    assert.deepEqual(hidden.data, []);
  } finally {
    await owner.query(
      'update public.app_members set active=true where user_id=$1',
      [staff.id],
    );
  }

  await assetTests(staff, viewer, assetMetadata, a, b, c, location('ITC-L'));
  await raceTests(staff, metadata, a, b, c);
  await readTests(
    staff,
    viewer,
    inactive,
    nonmember,
    metadata,
    assetMetadata,
    a,
    b,
  );
  console.log(
    'Inventory RPC accounting, authorization, versions, receipts, concurrency, assets, and read contracts passed (' +
      assertions +
      ' RPC assertions).',
  );
}

async function assetTests(
  staff: Actor,
  viewer: Actor,
  metadata: Payload,
  a: string,
  b: string,
  c: string,
  aggregate: string,
) {
  const tag = 'TAG-' + randomUUID();
  const created = await succeed(staff.client, 'asset_create', {
    ...metadata,
    location_id: a,
    asset_tag: '  ' + tag + '  ',
    serial_number: '  0001-A  ',
  });
  let version = 1;
  const base = () => ({
    asset_id: created.entity_id,
    expected_version: version,
  });
  const advance = (result: Mutation) => {
    assert.equal(result.version, version + 1);
    assert.equal(result.changed, true);
    version = result.version;
    return result;
  };
  let snapshot = await assetSnapshot(created.entity_id);
  assert.equal(snapshot.item.asset_tag, tag.toLowerCase());
  assert.equal(snapshot.item.serial_number, '0001-A');
  assert.equal(snapshot.events[0].kind, 'created');
  assert.equal(snapshot.events[0].to_location_id, a);
  await fail(
    staff.client,
    'asset_create',
    { ...metadata, location_id: a, asset_tag: tag.toLowerCase() },
    'P1007',
  );
  const duplicateSerial = await succeed(staff.client, 'asset_create', {
    ...metadata,
    location_id: a,
    asset_tag: ' ',
    serial_number: '0001-A',
  });
  assert.equal(
    (await assetSnapshot(duplicateSerial.entity_id)).item.asset_tag,
    null,
  );
  const serialMatches = await viewer.client
    .from('serialized_assets')
    .select('id')
    .eq('serial_number', '0001-A');
  assert.equal(serialMatches.error, null);
  assert.ok(serialMatches.data!.some((row) => row.id === created.entity_id));
  assert.ok(
    serialMatches.data!.some((row) => row.id === duplicateSerial.entity_id),
    'duplicate serial warning has contextual matches without rejecting creation',
  );
  await fail(
    staff.client,
    'asset_move',
    { ...base(), location_id: a },
    'P1005',
  );
  for (const destination of [aggregate, randomUUID()])
    await fail(
      staff.client,
      'asset_move',
      { ...base(), location_id: destination },
      'P1004',
    );
  const moved = advance(
    await succeed(staff.client, 'asset_move', { ...base(), location_id: b }),
  );
  const corrected = advance(
    await succeed(staff.client, 'asset_correct_location', {
      ...base(),
      location_id: c,
      reason: 'Record was wrong; no physical move',
    }),
  );
  snapshot = await assetSnapshot(created.entity_id);
  assert.deepEqual(
    snapshot.events
      .filter((event) =>
        [moved.event_id, corrected.event_id].includes(event.id),
      )
      .map((event) => [
        event.kind,
        event.from_location_id,
        event.to_location_id,
      ]),
    [
      ['moved', a, b],
      ['location_corrected', b, c],
    ],
  );
  await fail(
    staff.client,
    'asset_correct_location',
    { ...base(), location_id: a },
    'P1012',
  );
  await fail(
    staff.client,
    'asset_move',
    { ...base(), expected_version: 1, location_id: a },
    'P1002',
  );
  advance(
    await succeed(staff.client, 'asset_update', {
      ...base(),
      ...metadata,
      name: prefix + ' edited asset',
      asset_tag: tag,
      serial_number: '0001-A',
      model: 'Updated model',
    }),
  );
  snapshot = await assetSnapshot(created.entity_id);
  assert.equal(snapshot.events.at(-1).before_metadata.name, metadata.name);
  assert.equal(snapshot.events.at(-1).after_metadata.model, 'Updated model');
  const retired = advance(
    await succeed(staff.client, 'asset_retire', {
      ...base(),
      reason: 'Removed from service',
    }),
  );
  snapshot = await assetSnapshot(created.entity_id);
  assert.equal(snapshot.item.status, 'retired');
  assert.equal(snapshot.item.location_id, c);
  assert.equal(snapshot.events.at(-1).id, retired.event_id);
  await fail(
    staff.client,
    'asset_move',
    { ...base(), location_id: a },
    'P1008',
  );
  await fail(
    staff.client,
    'asset_correct_location',
    { ...base(), location_id: a, reason: 'Retired' },
    'P1008',
  );
  await fail(
    staff.client,
    'asset_retire',
    { ...base(), reason: 'Already retired' },
    'P1008',
  );
  await fail(
    staff.client,
    'asset_create',
    { ...metadata, location_id: a, asset_tag: tag.toUpperCase() },
    'P1007',
  );
  await fail(
    staff.client,
    'asset_restore',
    { ...base(), reason: 'Missing destination' },
    'P1012',
  );
  await fail(
    staff.client,
    'asset_restore',
    { ...base(), location_id: aggregate, reason: 'Invalid destination' },
    'P1004',
  );
  advance(
    await succeed(staff.client, 'asset_update', {
      ...base(),
      ...metadata,
      name: prefix + ' retired metadata correction',
      asset_tag: tag,
      serial_number: '0001-A',
    }),
  );
  advance(
    await succeed(staff.client, 'asset_restore', {
      ...base(),
      location_id: a,
      reason: 'Returned to active stock',
    }),
  );
  snapshot = await assetSnapshot(created.entity_id);
  assert.equal(snapshot.item.status, 'active');
  assert.equal(snapshot.item.location_id, a);
  assert.deepEqual(
    snapshot.events.map((event) => event.version),
    Array.from({ length: version }, (_, index) => index + 1),
  );
  assert.ok(snapshot.events.every((event) => event.actor_id === staff.id));
  await fail(
    staff.client,
    'asset_restore',
    { ...base(), location_id: b, reason: 'Already active' },
    'P1008',
  );
}

async function raceTests(
  staff: Actor,
  metadata: Payload,
  a: string,
  b: string,
  c: string,
) {
  const created = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' duplicate race',
    initial_quantity: 10,
    initial_location_id: a,
  });
  const requestId = randomUUID();
  const payload = {
    item_id: created.entity_id,
    expected_version: 1,
    location_id: b,
    quantity: 5,
    reason: 'Concurrent retry',
  };
  const duplicate = await concurrent(
    staff,
    created.entity_id,
    () => succeed(staff.client, 'quantity_receive', payload, requestId),
    () => succeed(staff.client, 'quantity_receive', payload, requestId),
  );
  assert.deepEqual(duplicate[0], duplicate[1]);
  let snapshot = await quantitySnapshot(created.entity_id);
  assert.equal(snapshot.item.version, 2);
  assert.equal(
    snapshot.events.length,
    2,
    'create plus exactly one received event',
  );
  assert.equal(
    snapshot.balances.find((row) => row.location_id === b).quantity,
    5,
  );
  assert.equal((await receipt(staff.id, requestId)).length, 1);

  const race = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' competing transfers',
    initial_quantity: 10,
    initial_location_id: a,
  });
  const transfer = {
    item_id: race.entity_id,
    expected_version: 1,
    source_location_id: a,
    quantity: 7,
  };
  const results = (await concurrent(
    staff,
    race.entity_id,
    () =>
      invoke(staff.client, 'quantity_move', {
        ...transfer,
        destination_location_id: b,
      }),
    () =>
      invoke(staff.client, 'quantity_move', {
        ...transfer,
        destination_location_id: c,
      }),
  )) as { error: { code: string } | null; data: Mutation | null }[];
  assert.equal(results.filter((result) => result.error === null).length, 1);
  assert.equal(results.find((result) => result.error)?.error?.code, 'P1002');
  snapshot = await quantitySnapshot(race.entity_id);
  assert.equal(snapshot.item.version, 2);
  assert.equal(snapshot.events.length, 2);
  assert.ok(snapshot.balances.every((row) => row.quantity >= 0));
  assert.equal(
    snapshot.balances.reduce((sum, row) => sum + row.quantity, 0),
    10,
  );
  assert.equal(
    snapshot.balances.find((row) => row.location_id === a).quantity,
    3,
  );
}

async function readTests(
  staff: Actor,
  viewer: Actor,
  inactive: Actor,
  nonmember: Actor,
  metadata: Payload,
  assetMetadata: Payload,
  a: string,
  b: string,
) {
  const literalName = prefix + ' literal_%\\part';
  const located = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: literalName,
    initial_quantity: 2,
    initial_location_id: a,
  });
  await succeed(staff.client, 'quantity_receive', {
    item_id: located.entity_id,
    expected_version: 1,
    location_id: b,
    quantity: 3,
    reason: 'Search second location',
  });
  await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' literalXXpart',
  });
  const unlocated = await succeed(staff.client, 'quantity_create', {
    ...metadata,
    name: prefix + ' unlocated',
  });
  const matches = await search(viewer.client, { p_query: literalName });
  assert.equal(matches.total, 2);
  assert.deepEqual(matches.rows.map((row) => row.location_code).sort(), [
    'ITC-S1A',
    'ITC-S1B',
  ]);
  assert.ok(
    matches.rows.every(
      (row) => row.location_id && row.breadcrumb?.includes('IT Closet'),
    ),
  );
  for (const text of ['literal_', 'literal_%', 'literal_%\\']) {
    const result = await search(viewer.client, {
      p_query: prefix + ' ' + text,
    });
    assert.equal(result.total, 2, 'wildcard characters are literal: ' + text);
  }
  const noStock = await search(viewer.client, {
    p_query: prefix + ' unlocated',
  });
  assert.equal(noStock.total, 1);
  assert.equal(noStock.rows[0].entity_id, unlocated.entity_id);
  assert.equal(noStock.rows[0].location_id, null);
  const subtree = await search(viewer.client, {
    p_query: literalName,
    p_location_code: 'ITC-L',
  });
  assert.equal(subtree.total, 2);
  assert.equal(
    (
      await search(viewer.client, {
        p_query: literalName,
        p_location_code: 'ITC-R',
      })
    ).total,
    0,
  );
  const first = await search(viewer.client, {
    p_query: literalName,
    p_page: 1,
    p_page_size: 1,
  });
  const second = await search(viewer.client, {
    p_query: literalName,
    p_page: 2,
    p_page_size: 1,
  });
  assert.equal(first.total, 2);
  assert.notEqual(first.rows[0].location_code, second.rows[0].location_code);
  assert.deepEqual(
    await search(viewer.client, {
      p_query: literalName,
      p_page: 1,
      p_page_size: 1,
    }),
    first,
  );
  assert.equal(
    (
      await search(viewer.client, {
        p_query: literalName,
        p_page: 3,
        p_page_size: 1,
      })
    ).rows.length,
    0,
  );

  const historical = await succeed(staff.client, 'asset_create', {
    ...assetMetadata,
    name: prefix + ' historical serial',
    location_id: a,
    serial_number: '0099-Z',
  });
  await succeed(staff.client, 'asset_retire', {
    asset_id: historical.entity_id,
    expected_version: 1,
    reason: 'Historical search fixture',
  });
  assert.equal(
    (await search(viewer.client, { p_query: prefix + ' historical serial' }))
      .total,
    0,
  );
  const retired = await search(viewer.client, {
    p_query: prefix + ' historical serial',
    p_status: 'historical',
  });
  assert.equal(retired.total, 1);
  assert.equal(retired.rows[0].status, 'retired');
  const serialMatches = await viewer.client.rpc('inventory_serial_matches', {
    p_serial: '\t 0099-z \n',
  });
  assert.equal(serialMatches.error, null);
  assert.ok(
    serialMatches.data.some(
      (row: { id: string; name: string; status: string }) =>
        row.id === historical.entity_id &&
        row.name === prefix + ' historical serial' &&
        row.status === 'retired',
    ),
  );
  const excludingSelf = await viewer.client.rpc('inventory_serial_matches', {
    p_serial: '0099-Z',
    p_exclude_id: historical.entity_id,
  });
  assert.equal(excludingSelf.error, null);
  assert.ok(
    excludingSelf.data.every(
      (row: { id: string }) => row.id !== historical.entity_id,
    ),
  );
  for (const serial of ['\t \n', '99-Z']) {
    const result = await viewer.client.rpc('inventory_serial_matches', {
      p_serial: serial,
    });
    assert.equal(result.error, null);
    assert.deepEqual(
      result.data,
      [],
      'blank input and removed leading zeros are not serial matches',
    );
  }
  assert.equal(
    (
      await search(viewer.client, { p_query: '0099-Z', p_status: 'all' })
    ).rows.some((row) => row.entity_id === historical.entity_id),
    true,
  );
  for (const denied of [inactive, nonmember]) {
    assert.equal((await search(denied.client, { p_query: prefix })).total, 0);
    const history = await denied.client.rpc('inventory_history', {
      p_entity_id: located.entity_id,
    });
    assert.equal(history.error, null);
    assert.deepEqual(history.data, { rows: [], total: 0 });
    const serial = await denied.client.rpc('inventory_serial_matches', {
      p_serial: '0099-Z',
    });
    assert.equal(serial.error, null);
    assert.deepEqual(serial.data, []);
  }
  const history = await viewer.client.rpc('inventory_history', {
    p_entity_id: located.entity_id,
    p_type: 'quantity',
  });
  assert.equal(history.error, null);
  assert.equal(history.data.total, 2);
  assert.ok(
    history.data.rows.every(
      (row: { actor_name: string; lines: unknown[] }) =>
        row.actor_name === staff.name && row.lines.length === 1,
    ),
  );
  const historyPage = async (
    page: number,
    locationCode: string | null = null,
  ) => {
    const result = await viewer.client.rpc('inventory_history', {
      p_type: 'quantity',
      p_entity_id: located.entity_id,
      p_location_code: locationCode,
      p_page: page,
      p_page_size: 1,
    });
    assert.equal(result.error, null);
    return result.data;
  };
  const firstHistory = await historyPage(1);
  const secondHistory = await historyPage(2);
  assert.equal(firstHistory.total, 2);
  assert.equal(secondHistory.total, 2);
  assert.deepEqual(
    [...firstHistory.rows, ...secondHistory.rows],
    history.data.rows,
    'history pagination returns the same deterministic order without duplicated events',
  );
  assert.deepEqual(await historyPage(1), firstHistory);
  assert.deepEqual(await historyPage(3), { rows: [], total: 2 });
  assert.equal((await historyPage(1, 'ITC-L')).total, 2);
  assert.equal((await historyPage(1, 'ITC-S1B')).total, 1);
  assert.equal((await historyPage(1, 'ITC-R')).total, 0);
  assert.equal(
    (await publicClient().rpc('inventory_search', {})).error?.code,
    '42501',
  );
  assert.equal(
    (await publicClient().rpc('inventory_history', {})).error?.code,
    '42501',
  );
  assert.equal(
    (
      await publicClient().rpc('inventory_serial_matches', {
        p_serial: '0099-Z',
      })
    ).error?.code,
    '42501',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(
      actors.map((person) => person.client.auth.signOut({ scope: 'local' })),
    );
    await owner.end();
  });
