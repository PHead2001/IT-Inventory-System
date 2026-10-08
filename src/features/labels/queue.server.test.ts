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
const preview = {
  answers: [
    {
      label: 'Description',
      type: 'text',
      displayValue: 'Braided cable',
      truncated: false,
    },
    { label: 'Reference', type: 'text', displayValue: id, truncated: false },
  ],
  truncated: false,
};
const searchRow = (key = id) => ({
  kind: 'quantity' as const,
  entity_id: key,
  name: 'Cable',
  category_name: 'Cables',
  status: 'active',
  asset_tag: null,
  item_code: '0001-A/B',
  serial_number: null,
  manufacturer: null,
  model: null,
  holding_context: 'ITC-S1A: 8; ITC-S1B: 4',
});
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.requireMember.mockReset().mockResolvedValue({
    supabase: { rpc: mocks.rpc },
  });
});

it('queries as the signed-in member and preserves one record-level result per ID', async () => {
  mocks.rpc
    .mockResolvedValueOnce({
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
    })
    .mockResolvedValueOnce({
      data: { ['quantity:' + id]: preview },
      error: null,
    });
  const result = await searchLabelRecords({
    ...defaultFilters,
    q: id,
    page: 2,
  });
  expect(mocks.requireMember).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'metadata_preview_batch', {
    p_keys: [{ kind: 'quantity', id }],
  });
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
        customPreview: preview,
      },
    ],
  });
});

it('loads previews for only the returned 25-record page in one authorized batch', async () => {
  const rows = Array.from({ length: 25 }, (_, index) =>
    searchRow(
      `7b84a7cf-197b-45b1-8016-${index.toString(16).padStart(12, '0')}`,
    ),
  );
  const previews = Object.fromEntries(
    rows.map((row) => [
      'quantity:' + row.entity_id,
      { answers: [], truncated: false },
    ]),
  );
  mocks.rpc
    .mockResolvedValueOnce({ data: { total: 91, rows }, error: null })
    .mockResolvedValueOnce({ data: previews, error: null });
  const result = await searchLabelRecords({ ...defaultFilters, page: 3 });
  expect(mocks.requireMember).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'metadata_preview_batch', {
    p_keys: rows.map((row) => ({ kind: row.kind, id: row.entity_id })),
  });
  expect(result).toMatchObject({ total: 91, page: 3, pageSize: 25 });
  expect(result.rows).toHaveLength(25);
  expect(result.rows.map((row) => row.key)).toEqual(
    rows.map((row) => row.entity_id),
  );
});

it('does not fetch a preview batch for an empty search page', async () => {
  mocks.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
  expect(await searchLabelRecords(defaultFilters)).toEqual({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  expect(mocks.requireMember).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalledWith(
    'metadata_preview_batch',
    expect.anything(),
  );
});

it('rejects oversized search pages before any preview read', async () => {
  mocks.rpc.mockResolvedValue({
    data: { total: 26, rows: Array.from({ length: 26 }, () => searchRow()) },
    error: null,
  });
  await expect(searchLabelRecords(defaultFilters)).rejects.toThrow();
  expect(mocks.rpc).toHaveBeenCalledOnce();
});

it('deduplicates preview keys within the returned page without changing record identities', async () => {
  mocks.rpc
    .mockResolvedValueOnce({
      data: { total: 2, rows: [searchRow(), searchRow()] },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { ['quantity:' + id]: preview },
      error: null,
    });
  const result = await searchLabelRecords(defaultFilters);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'metadata_preview_batch', {
    p_keys: [{ kind: 'quantity', id }],
  });
  expect(result.rows.map((row) => row.key)).toEqual([id, id]);
  expect(
    result.rows.every(
      (row) => row.customPreview?.answers[1].displayValue === id,
    ),
  ).toBe(true);
});

it('propagates authorized preview read failure instead of showing an incomplete successful search', async () => {
  mocks.rpc
    .mockResolvedValueOnce({
      data: { total: 1, rows: [searchRow()] },
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
  await expect(searchLabelRecords(defaultFilters)).rejects.toThrow(
    'Inventory metadata could not be loaded.',
  );
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
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
