import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { GET } from './route';
const locations = [
  {
    id: 'root',
    code: 'ITC',
    name: 'Closet',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
  {
    id: 'drawer',
    code: 'ITC-D01',
    name: 'Drawer',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'inactive',
    code: 'ITC-D02',
    name: 'Inactive',
    active: false,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'parent',
    code: 'ITC-S1A',
    name: 'Parent',
    active: true,
    can_hold_inventory: true,
    parentId: 'root',
  },
  {
    id: 'unmodeled',
    code: 'UNMODELED',
    name: 'Child',
    active: true,
    can_hold_inventory: true,
    parentId: 'parent',
  },
];
function caller(userId = 'member', count = '9007199254740993') {
  const ids = new Map(
    locations.map((location, index) => [
      location.id,
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    ]),
  );
  const query = {
    order: vi.fn(),
    then: (done: (value: unknown) => unknown) =>
      Promise.resolve({
        data: locations.map((location) => ({
          ...location,
          id: ids.get(location.id),
          parent_id: location.parentId ? ids.get(location.parentId) : null,
          breadcrumb: location.name,
        })),
        error: null,
      }).then(done),
  };
  query.order.mockReturnValue(query);
  return {
    member: { user_id: userId },
    supabase: {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ location_code: 'ITC-D01', entry_count: count }],
        error: null,
      }),
    },
  };
}
let context: ReturnType<typeof caller>;
beforeEach(() => {
  vi.resetAllMocks();
  context = caller();
  mocks.member.mockResolvedValue(context);
});
const request = (space = 'it-closet') =>
  new NextRequest(
    'https://inventory.example/api/room/occupancy?space=' + space,
  );
it('authorizes before reads and issues one bounded call for modeled active leaves', async () => {
  const result = await GET(request());
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mocks.member).toHaveBeenCalledOnce();
  expect(context.supabase.from).toHaveBeenCalledExactlyOnceWith(
    'inventory_locations',
  );
  expect(context.supabase.rpc).toHaveBeenCalledExactlyOnceWith(
    'inventory_location_entry_counts',
    { p_location_codes: ['ITC-D01'] },
  );
  expect(await result.json()).toEqual({
    identity: {
      userId: 'member',
      environment: 'https://inventory.example',
      spaceId: 'it-closet',
      filter: 'type=all;status=active',
    },
    counts: { 'ITC-D01': '9007199254740993' },
  });
  mocks.member.mockRejectedValue(new Error('denied'));
  await expect(GET(request())).rejects.toThrow('denied');
  expect(context.supabase.rpc).toHaveBeenCalledOnce();
  expect(context.supabase.from).toHaveBeenCalledOnce();
});
it('never substitutes another space or invents zero counts on failure', async () => {
  expect((await GET(request('unknown'))).status).toBe(404);
  expect(context.supabase.rpc).not.toHaveBeenCalled();
  context.supabase.rpc.mockRejectedValue(new Error('private database detail'));
  const result = await GET(request());
  expect(result.status).toBe(500);
  expect(await result.json()).toEqual({
    error: 'Item counts could not be loaded.',
  });
});

it('isolates overlapping request identities and count clients, then rechecks a denied request', async () => {
  const first = caller('first', '1');
  const second = caller('second', '2');
  mocks.member
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
    .mockRejectedValueOnce(new Error('membership revoked'));
  const results = await Promise.all([GET(request()), GET(request())]);
  const bodies = await Promise.all(results.map((result) => result.json()));
  expect(bodies[0]).toMatchObject({
    identity: { userId: 'first' },
    counts: { 'ITC-D01': '1' },
  });
  expect(bodies[1]).toMatchObject({
    identity: { userId: 'second' },
    counts: { 'ITC-D01': '2' },
  });
  expect(first.supabase.rpc).toHaveBeenCalledOnce();
  expect(second.supabase.rpc).toHaveBeenCalledOnce();
  await expect(GET(request())).rejects.toThrow('membership revoked');
  expect(mocks.member).toHaveBeenCalledTimes(3);
  expect(first.supabase.rpc).toHaveBeenCalledOnce();
  expect(second.supabase.rpc).toHaveBeenCalledOnce();
});
