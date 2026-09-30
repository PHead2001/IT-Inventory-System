import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
import { getQueueRecords, searchLabelRecords } from './queue.server';
import { defaultFilters } from './queue-model';

const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.requireMember.mockReset().mockResolvedValue({
    supabase: { rpc: mocks.rpc },
  });
});

it('queries as the signed-in member and preserves one record-level result per ID', async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      total: 1,
      rows: [
        {
          kind: 'quantity',
          entity_id: id,
          name: 'Cable',
          category_name: 'Cables',
          status: 'active',
          asset_tag: null,
          item_code: '0001-A/B',
          serial_number: null,
          manufacturer: null,
          model: null,
          holding_context: 'ITC-S1A: 8; ITC-S1B: 4',
        },
      ],
    },
    error: null,
  });
  const result = await searchLabelRecords({
    ...defaultFilters,
    q: id,
    page: 2,
  });
  expect(mocks.requireMember).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith(
    'inventory_label_search',
    expect.objectContaining({ p_query: id, p_page: 2, p_page_size: 25 }),
  );
  expect(result).toMatchObject({
    total: 1,
    page: 2,
    rows: [
      {
        key: id,
        kind: 'quantity',
        itemCode: '0001-A/B',
        holdingContext: 'ITC-S1A: 8; ITC-S1B: 4',
      },
    ],
  });
});

it('resolves exact mixed IDs in one caller-scoped request and maps stable QR routes', async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        kind: 'location',
        key: 'ITC',
        name: 'Renamed room',
        context: 'Renamed room',
        state: 'active',
        tag: null,
        category_name: null,
        manufacturer: null,
        model: null,
        serial_number: null,
        location_hierarchy: 'Renamed room',
        holding_context: 'Renamed room',
      },
      {
        kind: 'quantity',
        key: id,
        name: 'Cables',
        context: 'Adapters',
        state: 'archived',
        tag: null,
        item_code: '0001-A/B',
        category_name: 'Adapters',
        manufacturer: 'Acme',
        model: '3FT 10Gbps',
        serial_number: null,
        location_hierarchy: null,
        holding_context: 'ITC-S1A: 8',
      },
    ],
    error: null,
  });
  const selection = [
    { kind: 'location' as const, key: 'ITC' },
    { kind: 'quantity' as const, key: id },
  ];
  const result = await getQueueRecords(selection);
  expect(mocks.rpc).toHaveBeenCalledWith('inventory_label_resolve', {
    p_selection: selection,
  });
  expect(result.map((row) => row.path)).toEqual([
    '/locations/ITC',
    '/inventory/quantity/' + id,
  ]);
  expect(result[1].state).toBe('archived');
  expect(result[1].humanId).toBe('0001-A/B');
  expect(result[1].holdingContext).toBe('ITC-S1A: 8');
  expect(result[1]).toMatchObject({
    categoryName: 'Adapters',
    manufacturer: 'Acme',
    model: '3FT 10Gbps',
    locationHierarchy: null,
  });
});

it('rejects duplicate/oversized input before the RPC and propagates read failure', async () => {
  await expect(
    getQueueRecords([
      { kind: 'quantity', key: id },
      { kind: 'quantity', key: id },
    ]),
  ).rejects.toThrow('Invalid label selection');
  await expect(
    getQueueRecords(
      Array.from({ length: 201 }, (_, index) => ({
        kind: 'quantity' as const,
        key: `7b84a7cf-197b-45b1-8016-${index.toString(16).padStart(12, '0')}`,
      })),
    ),
  ).rejects.toThrow('Invalid label selection');
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
  await expect(
    getQueueRecords([{ kind: 'quantity', key: id }]),
  ).rejects.toThrow('could not be refreshed');
});
