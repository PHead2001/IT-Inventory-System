import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { createInventoryReadScope } from './queries.server';

function client(error: unknown = null) {
  const query = {
    order: vi.fn(),
    then: (done: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error }).then(done),
  };
  query.order.mockReturnValue(query);
  const select = vi.fn().mockReturnValue(query);
  return {
    from: vi.fn().mockReturnValue({ select }),
    rpc: vi
      .fn()
      .mockResolvedValue({ data: { rows: [], total: 0 }, error: null }),
  };
}
beforeEach(() => vi.resetAllMocks());

it('authenticates once and shares one lazy location read across concurrent scope reads', async () => {
  const supabase = client();
  mocks.member.mockResolvedValue({ member: { user_id: 'first' }, supabase });
  const scope = await createInventoryReadScope();
  expect(supabase.from).not.toHaveBeenCalled();
  await Promise.all([
    scope.getLocations(),
    scope.getInventory({}),
    scope.getLocations(),
  ]);
  expect(mocks.member).toHaveBeenCalledOnce();
  expect(supabase.from).toHaveBeenCalledExactlyOnceWith('inventory_locations');
  expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith(
    'inventory_search_v3',
    expect.any(Object),
  );
});

it('keeps overlapping actor scopes separate and rechecks membership on a later request', async () => {
  const first = client();
  const second = client();
  mocks.member
    .mockResolvedValueOnce({ member: { user_id: 'first' }, supabase: first })
    .mockResolvedValueOnce({ member: { user_id: 'second' }, supabase: second })
    .mockRejectedValueOnce(new Error('membership revoked'));
  const [a, b] = await Promise.all([
    createInventoryReadScope(),
    createInventoryReadScope(),
  ]);
  await Promise.all([a.getInventory({}), b.getInventory({})]);
  expect(a.member.user_id).toBe('first');
  expect(b.member.user_id).toBe('second');
  expect(first.from).toHaveBeenCalledOnce();
  expect(second.from).toHaveBeenCalledOnce();
  await expect(createInventoryReadScope()).rejects.toThrow(
    'membership revoked',
  );
  expect(mocks.member).toHaveBeenCalledTimes(3);
});

it('retains location failures within this scope without poisoning a later request', async () => {
  const bad = client(new Error('backend unavailable'));
  const good = client();
  mocks.member
    .mockResolvedValueOnce({ member: {}, supabase: bad })
    .mockResolvedValueOnce({ member: {}, supabase: good });
  const first = await createInventoryReadScope();
  await expect(first.getLocations()).rejects.toThrow(
    'Locations could not be loaded.',
  );
  await expect(first.getInventory({})).rejects.toThrow(
    'Locations could not be loaded.',
  );
  expect(bad.from).toHaveBeenCalledOnce();
  await expect(
    (await createInventoryReadScope()).getLocations(),
  ).resolves.toEqual([]);
  expect(good.from).toHaveBeenCalledOnce();
});

it('does not start location or inventory queries when filter normalization rejects invalid runtime input', async () => {
  const supabase = client();
  mocks.member.mockResolvedValue({ member: {}, supabase });
  const scope = await createInventoryReadScope();
  await expect(
    scope.getInventory({ q: 42 } as unknown as Record<
      string,
      string | undefined
    >),
  ).rejects.toThrow();
  expect(supabase.from).not.toHaveBeenCalled();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
