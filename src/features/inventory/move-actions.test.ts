import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  user: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  detail: vi.fn(),
  locations: vi.fn(),
  history: vi.fn(),
  names: vi.fn(),
  member: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('./queries.server', () => ({
  duplicateSerials: vi.fn(),
  getQuantityDetail: mocks.detail,
  getLocations: mocks.locations,
}));
import {
  reloadMoveReceipt,
  loadMoveSnapshot,
  submitInventory,
} from './actions';
const actor = '00000000-0000-4000-8000-000000000099';
const entity = '00000000-0000-4000-8000-000000000010';
const eventId = '00000000-0000-4000-8000-000000000030';
const source = '00000000-0000-4000-8000-000000000001';
const destination = '00000000-0000-4000-8000-000000000002';
const input = { entityId: entity, eventId, expectedActorId: actor };
const row = {
  id: eventId,
  entity_id: entity,
  kind: 'quantity',
  event_type: 'moved',
  entity_name: 'Checkpoint cables',
  created_at: '2026-10-07T12:00:00Z',
  lines: [
    { location_id: source, delta: -1, before_quantity: 2, after_quantity: 1 },
    {
      location_id: destination,
      delta: 1,
      before_quantity: 0,
      after_quantity: 1,
    },
  ],
};
const membership = {
  user_id: actor,
  role: 'staff',
  active: true,
  display_name: 'Staff',
};
const filters: Record<string, ReturnType<typeof vi.fn>> = {};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.user },
    from: mocks.from,
    rpc: mocks.rpc,
  });
  mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.member.mockResolvedValue({ data: membership, error: null });
  mocks.history.mockResolvedValue({ data: row, error: null });
  mocks.names.mockResolvedValue({
    data: [
      { id: source, name: 'Red Container' },
      { id: destination, name: 'Black Container' },
    ],
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const eq = vi.fn();
    filters[table] = eq;
    const query = {
      select: vi.fn(),
      eq,
      maybeSingle: table === 'app_members' ? mocks.member : mocks.history,
      in: mocks.names,
    };
    query.select.mockReturnValue(query);
    eq.mockReturnValue(query);
    return query;
  });
  mocks.rpc.mockResolvedValue({
    data: { entity_id: entity, version: 2, event_id: eventId, changed: true },
    error: null,
  });
  mocks.detail.mockResolvedValue({
    item: { id: entity, version: 3, archived: false },
    balances: [],
  });
  mocks.locations.mockResolvedValue([]);
});
it('reads only the exact authorized move event and derives balances from immutable lines', async () => {
  const receipt = await reloadMoveReceipt(input);
  expect(receipt).toEqual({
    createdAt: row.created_at,
    itemName: row.entity_name,
    quantity: 1,
    source: { id: source, name: 'Red Container', after: 1 },
    destination: { id: destination, name: 'Black Container', after: 1 },
  });
  expect(filters.inventory_history_rows.mock.calls).toEqual([
    ['id', eventId],
    ['entity_id', entity],
    ['kind', 'quantity'],
    ['event_type', 'moved'],
  ]);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from.mock.calls.flat()).not.toContain('stock_balances');
});
it.each(['viewer', 'staff'])(
  'allows active %s to reload an already visible receipt',
  async (role) => {
    mocks.member.mockResolvedValue({
      data: { ...membership, role },
      error: null,
    });
    expect((await reloadMoveReceipt(input)).quantity).toBe(1);
  },
);
it.each([
  ['signed out', null, membership],
  ['wrong actor', { id: source }, membership],
  ['inactive', { id: actor }, { ...membership, active: false }],
  ['nonmember', { id: actor }, null],
])(
  'denies %s before receipt or snapshot data reads',
  async (_label, user, member) => {
    mocks.user.mockResolvedValue({ data: { user }, error: null });
    mocks.member.mockResolvedValue({ data: member, error: null });
    await expect(reloadMoveReceipt(input)).rejects.toThrow();
    await expect(
      loadMoveSnapshot({ entityId: entity, expectedActorId: actor }),
    ).rejects.toThrow();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.names).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it('validates receipt input before obtaining credentials', async () => {
  await expect(
    reloadMoveReceipt({ ...input, eventId: 'bad' }),
  ).rejects.toThrow();
  expect(mocks.client).not.toHaveBeenCalled();
});
it.each([
  ['wrong event', { ...row, id: source }],
  ['wrong entity', { ...row, entity_id: source }],
  ['wrong kind', { ...row, event_type: 'received' }],
  ['missing line', { ...row, lines: row.lines.slice(0, 1) }],
  [
    'unequal transfer',
    {
      ...row,
      lines: [row.lines[0], { ...row.lines[1], delta: 2, after_quantity: 2 }],
    },
  ],
  [
    'same location',
    { ...row, lines: [row.lines[0], { ...row.lines[1], location_id: source }] },
  ],
  [
    'negative result',
    { ...row, lines: [{ ...row.lines[0], after_quantity: -1 }, row.lines[1]] },
  ],
  [
    'wrong arithmetic',
    { ...row, lines: [{ ...row.lines[0], after_quantity: 2 }, row.lines[1]] },
  ],
])('rejects malformed history: %s', async (_label, data) => {
  mocks.history.mockResolvedValue({ data, error: null });
  await expect(reloadMoveReceipt(input)).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps commit acknowledgement and event identity when receipt lookup fails', async () => {
  mocks.history.mockResolvedValue({
    data: null,
    error: { message: 'read failed' },
  });
  const result = await submitInventory({
    operation: 'quantity_move',
    requestId: eventId,
    expectedActorId: actor,
    payload: {
      item_id: entity,
      expected_version: 1,
      source_location_id: source,
      destination_location_id: destination,
      quantity: 1,
      move_all: false,
    },
  });
  expect(result).toMatchObject({
    ok: true,
    entityId: entity,
    eventId,
    version: '2',
    refreshFailed: true,
  });
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
it('keeps the committed receipt when cache invalidation fails after commit', async () => {
  mocks.revalidate.mockImplementation(() => {
    throw new Error('cache unavailable');
  });
  const result = await submitInventory({
    operation: 'quantity_move',
    requestId: eventId,
    expectedActorId: actor,
    payload: {
      item_id: entity,
      expected_version: 1,
      source_location_id: source,
      destination_location_id: destination,
      quantity: 1,
      move_all: false,
    },
  });
  expect(result).toMatchObject({
    ok: true,
    eventId,
    movement: { quantity: 1 },
    refreshFailed: true,
  });
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
it('loads a fresh authorized snapshot without issuing any mutation', async () => {
  expect(
    await loadMoveSnapshot({ entityId: entity, expectedActorId: actor }),
  ).toMatchObject({ item: { version: 3 }, balances: [] });
  expect(mocks.detail).toHaveBeenCalledWith(entity);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
