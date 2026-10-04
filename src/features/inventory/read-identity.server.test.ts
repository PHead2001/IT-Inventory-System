import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: m.member }));
import { getHistoryRecord, hasRecordedInventory } from './queries.server';
const id = '00000000-0000-4000-8000-000000000001';
function client(quantity: unknown, asset: unknown, error: unknown = null) {
  const selects: Record<
    string,
    {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
    }
  > = {};
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'quantity_items' ? quantity : asset,
        error,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    selects[table] = query;
    return query;
  });
  return {
    from,
    selects,
    rpc: vi
      .fn()
      .mockResolvedValue({ data: { rows: [], total: 0 }, error: null }),
  };
}
beforeEach(() => vi.resetAllMocks());
it('resolves historical-readable names via two narrow reads under the current caller and checks again per request', async () => {
  const first = client({ id, name: 'Archived adapters' }, null);
  const second = client(null, { id, name: 'Retired laptop' });
  m.member
    .mockResolvedValueOnce({ supabase: first })
    .mockResolvedValueOnce({ supabase: second });
  const [a, b] = await Promise.all([
    getHistoryRecord(id),
    getHistoryRecord(id),
  ]);
  expect(a).toEqual({ id, name: 'Archived adapters', kind: 'quantity' });
  expect(b).toEqual({ id, name: 'Retired laptop', kind: 'asset' });
  expect(m.member).toHaveBeenCalledTimes(2);
  for (const supabase of [first, second])
    for (const query of Object.values(supabase.selects)) {
      expect(query.select).toHaveBeenCalledWith('id,name');
      expect(query.eq).toHaveBeenCalledWith('id', id);
      expect(query.limit).toHaveBeenCalledWith(1);
    }
});
it.each([
  ['missing', null, null],
  ['ambiguous', { id, name: 'Private item' }, { id, name: 'Private asset' }],
])(
  'does not expose %s identity or query history',
  async (_, quantity, asset) => {
    const supabase = client(quantity, asset);
    m.member.mockResolvedValue({ supabase });
    expect(await getHistoryRecord(id)).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  },
);
it('rejects malformed scope before table reads and treats backend failure as an error', async () => {
  const supabase = client(null, null, new Error('unavailable'));
  m.member.mockResolvedValue({ supabase });
  expect(await getHistoryRecord('invalid')).toBeNull();
  expect(supabase.from).not.toHaveBeenCalled();
  await expect(getHistoryRecord(id)).rejects.toThrow(
    'Record identity could not be loaded.',
  );
});
it.each(['anonymous', 'inactive member'])(
  'does not read identity or catalog for %s',
  async () => {
    const supabase = client({ id, name: 'Private' }, null);
    m.member.mockRejectedValue(new Error('access denied'));
    await expect(getHistoryRecord(id)).rejects.toThrow('access denied');
    await expect(hasRecordedInventory()).rejects.toThrow('access denied');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  },
);
it('probes catalog presence with one caller-authorized search row including all statuses; failure is not absence', async () => {
  const supabase = client(null, null);
  m.member.mockResolvedValue({ supabase, member: { role: 'viewer' } });
  expect(await hasRecordedInventory()).toBe(false);
  expect(supabase.rpc).toHaveBeenCalledWith('inventory_search_v3', {
    p_type: 'all',
    p_status: 'all',
    p_page: 1,
    p_page_size: 1,
  });
  expect(supabase.from).not.toHaveBeenCalled();
  supabase.rpc.mockResolvedValueOnce({
    data: { rows: [], total: 1 },
    error: null,
  });
  expect(await hasRecordedInventory()).toBe(true);
  supabase.rpc.mockResolvedValueOnce({
    data: null,
    error: new Error('read failed'),
  });
  await expect(hasRecordedInventory()).rejects.toThrow(
    'Inventory presence could not be loaded.',
  );
});
