import { beforeEach, expect, it, vi } from 'vitest';
import {
  findAssignmentRecords,
  inspectAssignmentRecord,
} from './assign-actions';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  sites: vi.fn(),
  quantity: vi.fn(),
  asset: vi.fn(),
  search: vi.fn(),
  resolve: vi.fn(),
  itemCode: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.session }));
vi.mock('@/features/custody/queries.server', () => ({ getSites: mocks.sites }));
vi.mock('@/features/inventory/queries.server', () => ({
  getQuantityDetail: mocks.quantity,
  getAssetDetail: mocks.asset,
}));
vi.mock('@/features/labels/queue.server', () => ({
  searchLabelRecords: mocks.search,
}));
vi.mock('./resolve.server', () => ({
  resolveScan: mocks.resolve,
  resolveItemCode: mocks.itemCode,
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const args = {
  actorId: id(1),
  siteId: id(2),
  path: '/inventory/quantity/' + id(3),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    member: { user_id: args.actorId, role: 'staff', active: true },
  });
  mocks.sites.mockResolvedValue([{ id: args.siteId, active: true }]);
  mocks.quantity.mockResolvedValue({
    item: {
      id: id(3),
      name: 'Adapters',
      itemCode: '0001-A/B',
      version: 7,
      archived: false,
    },
    balances: [
      {
        quantity: 2,
        location: { id: id(4), breadcrumb: 'Closet / Red', active: false },
      },
    ],
  });
});
it('reuses authorized existing inventory reads and preserves captured version and inactive-source evacuation', async () => {
  expect(await inspectAssignmentRecord(args)).toMatchObject({
    ok: true,
    candidate: {
      kind: 'quantity',
      version: '7',
      identifier: '0001-A/B',
      sources: [{ active: false, quantity: 2 }],
    },
  });
  expect(mocks.quantity).toHaveBeenCalledWith(id(3));
});
it.each([
  { role: 'viewer', active: true, user_id: id(1) },
  { role: 'staff', active: false, user_id: id(1) },
  { role: 'staff', active: true, user_id: id(9) },
])('rejects unauthorized context before record reads: %o', async (member) => {
  mocks.session.mockResolvedValue({ member });
  expect(await inspectAssignmentRecord(args)).toMatchObject({ ok: false });
  expect(
    await findAssignmentRecords({
      actorId: args.actorId,
      text: 'test',
      mode: 'identifier',
    }),
  ).toMatchObject({ ok: false });
  expect(mocks.quantity).not.toHaveBeenCalled();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(
    await findAssignmentRecords({
      actorId: args.actorId,
      text: 'Adapters',
      mode: 'search',
      page: 2,
    }),
  ).toMatchObject({ ok: false });
  expect(mocks.search).not.toHaveBeenCalled();
});
it('rejects archived destinations and location labels without inventing reassignment', async () => {
  mocks.sites.mockResolvedValue([{ id: args.siteId, active: false }]);
  expect(await inspectAssignmentRecord(args)).toMatchObject({
    ok: false,
    message: expect.stringContaining('no longer active'),
  });
  expect(mocks.quantity).not.toHaveBeenCalled();
  expect(
    await inspectAssignmentRecord({ ...args, path: '/locations/ITC-RED' }),
  ).toMatchObject({ ok: false, message: expect.stringContaining('location') });
});
it('returns already-assigned asset custody honestly with no storage source', async () => {
  mocks.asset.mockResolvedValue({
    asset: {
      id: id(3),
      name: 'Laptop',
      assetTag: '00007',
      serialNumber: null,
      version: 8,
      status: 'active',
    },
    location: null,
    site: { name: 'Remote site' },
  });
  expect(
    await inspectAssignmentRecord({
      ...args,
      path: '/inventory/assets/' + id(3),
    }),
  ).toMatchObject({
    ok: true,
    candidate: { currentSite: 'Remote site', sources: [], version: '8' },
  });
});
it('uses bounded record-level search and canonical typed identities with explicit pagination', async () => {
  const row = {
    kind: 'quantity',
    key: id(3),
    name: 'Adapters',
    itemCode: '0001',
    assetTag: null,
    status: 'active',
  };
  mocks.search.mockResolvedValue({
    rows: [row, row, { ...row, kind: 'asset', assetTag: '0001' }],
    total: 26,
    page: 2,
    pageSize: 25,
  });
  const result = await findAssignmentRecords({
    actorId: args.actorId,
    text: ' Adapter ',
    mode: 'search',
    page: 2,
  });
  expect(result).toMatchObject({
    ok: true,
    status: 'ambiguous',
    searchPage: { query: 'Adapter', total: 26, page: 2, pageSize: 25 },
  });
  if (result.ok)
    expect(result.matches.map((row) => row.kind)).toEqual([
      'quantity',
      'asset',
    ]);
  expect(mocks.search).toHaveBeenCalledWith({
    q: 'Adapter',
    type: 'all',
    status: 'all',
    category: '',
    location: '',
    page: 2,
  });
  if (result.ok)
    expect(result.matches.map((match) => match.path)).toEqual([
      '/inventory/quantity/' + id(3),
      '/inventory/assets/' + id(3),
    ]);
});
it('keeps later records reachable when an earlier quantity has many location holdings', async () => {
  mocks.search
    .mockResolvedValueOnce({
      rows: [
        {
          kind: 'quantity',
          key: id(3),
          name: 'Adapters',
          itemCode: '0001',
          status: 'active',
          holdingContext: Array.from(
            { length: 30 },
            (_, n) => `Shelf ${n}: 1`,
          ).join('; '),
        },
      ],
      total: 26,
      page: 1,
      pageSize: 25,
    })
    .mockResolvedValueOnce({
      rows: [
        {
          kind: 'asset',
          key: id(26),
          name: 'Last laptop',
          assetTag: '00026',
          status: 'active',
        },
      ],
      total: 26,
      page: 2,
      pageSize: 25,
    });
  const first = await findAssignmentRecords({
    actorId: args.actorId,
    text: 'Laptop',
    mode: 'search',
  });
  const later = await findAssignmentRecords({
    actorId: args.actorId,
    text: 'Laptop',
    mode: 'search',
    page: 2,
  });
  expect(first).toMatchObject({ ok: true, searchPage: { page: 1, total: 26 } });
  expect(later).toMatchObject({
    ok: true,
    matches: [{ path: '/inventory/assets/' + id(26) }],
    searchPage: { page: 2, total: 26 },
  });
  expect(mocks.search).toHaveBeenCalledTimes(2);
});
