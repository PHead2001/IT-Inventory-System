import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  locations: vi.fn(),
  counts: vi.fn(),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  createInventoryReadScope: mocks.scope,
}));
vi.mock('@/features/room/occupancy.server', () => ({
  getLocationEntryCounts: mocks.counts,
}));
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
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue({
    member: { user_id: 'member' },
    getLocations: mocks.locations,
  });
  mocks.locations.mockResolvedValue(locations);
  mocks.counts.mockResolvedValue({ 'ITC-D01': '9007199254740993' });
});
const request = (space = 'it-closet') =>
  new NextRequest(
    'https://inventory.example/api/room/occupancy?space=' + space,
  );
it('authorizes before reads and issues one bounded call for modeled active leaves', async () => {
  const result = await GET(request());
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mocks.counts).toHaveBeenCalledExactlyOnceWith(['ITC-D01']);
  expect(await result.json()).toEqual({
    identity: {
      userId: 'member',
      environment: 'https://inventory.example',
      spaceId: 'it-closet',
      filter: 'type=all;status=active',
    },
    counts: { 'ITC-D01': '9007199254740993' },
  });
  mocks.scope.mockRejectedValue(new Error('denied'));
  await expect(GET(request())).rejects.toThrow('denied');
  expect(mocks.counts).toHaveBeenCalledOnce();
});
it('never substitutes another space or invents zero counts on failure', async () => {
  expect((await GET(request('unknown'))).status).toBe(404);
  expect(mocks.counts).not.toHaveBeenCalled();
  mocks.counts.mockRejectedValue(new Error('private database detail'));
  const result = await GET(request());
  expect(result.status).toBe(500);
  expect(await result.json()).toEqual({
    error: 'Item counts could not be loaded.',
  });
});
