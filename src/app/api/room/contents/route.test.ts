import { beforeEach, expect, it, vi } from 'vitest';
import type { LocationRef } from '@/features/inventory/contracts-ui';
const mocks = vi.hoisted(() => ({
  createInventoryReadScope: vi.fn(),
  getLocations: vi.fn(),
  getInventory: vi.fn(),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  createInventoryReadScope: mocks.createInventoryReadScope,
}));
import { NextRequest } from 'next/server';
import { GET } from './route';

const locations: LocationRef[] = [
  {
    id: '1',
    code: 'ITC',
    name: 'IT Closet',
    breadcrumb: 'IT Closet',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
  {
    id: '2',
    code: 'ITC-D01',
    name: 'Drawer 1',
    breadcrumb: 'IT Closet / Drawer 1',
    active: true,
    can_hold_inventory: true,
    parentId: '1',
  },
  {
    id: '3',
    code: 'ITO',
    name: 'IT Office',
    breadcrumb: 'IT Office',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createInventoryReadScope.mockResolvedValue({
    member: { user_id: 'test' },
    getLocations: mocks.getLocations,
    getInventory: mocks.getInventory,
  });
  mocks.getLocations.mockResolvedValue(locations);
  mocks.getInventory.mockResolvedValue({
    rows: [],
    total: 0,
    page: 2,
    pageSize: 25,
  });
});
function request(query: string) {
  return new NextRequest(
    'https://inventory.example/api/room/contents?' + query,
  );
}

it('requires membership before reading contents', async () => {
  mocks.createInventoryReadScope.mockRejectedValue(new Error('access denied'));
  await expect(GET(request('location=ITC-D01'))).rejects.toThrow(
    'access denied',
  );
  expect(mocks.getInventory).not.toHaveBeenCalled();
  expect(mocks.getLocations).not.toHaveBeenCalled();
});
it('rejects a location outside the chosen space', async () => {
  const result = await GET(request('space=it-office&location=ITC-D01'));
  expect(result.status).toBe(404);
  expect(result.headers.get('Cache-Control')).toContain('no-store');
  expect(mocks.getInventory).not.toHaveBeenCalled();
});
it('uses established aggregate inventory paging without response caching', async () => {
  const result = await GET(request('space=it-closet&location=ITC&page=2'));
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toContain('no-store');
  expect(mocks.getInventory).toHaveBeenCalledWith({
    location: 'ITC',
    page: '2',
  });
  const body = await result.json();
  expect(body.identity).toEqual({
    userId: 'test',
    environment: 'https://inventory.example',
    spaceId: 'it-closet',
    locationCode: 'ITC',
    filter: 'type=all;status=active',
    page: 2,
  });
  expect(body.result.page).toBe(2);
  expect(mocks.createInventoryReadScope).toHaveBeenCalledOnce();
  expect(mocks.getLocations).toHaveBeenCalledOnce();
});

it('constructs a fresh scope and response identity for each actor/request', async () => {
  const secondRead = vi
    .fn()
    .mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
  mocks.createInventoryReadScope
    .mockResolvedValueOnce({
      member: { user_id: 'first' },
      getLocations: mocks.getLocations,
      getInventory: mocks.getInventory,
    })
    .mockResolvedValueOnce({
      member: { user_id: 'second' },
      getLocations: vi.fn().mockResolvedValue(locations),
      getInventory: secondRead,
    });
  const first = await GET(request('location=ITC-D01'));
  const second = await GET(request('location=ITC-D01'));
  expect((await first.json()).identity.userId).toBe('first');
  expect((await second.json()).identity.userId).toBe('second');
  expect(mocks.createInventoryReadScope).toHaveBeenCalledTimes(2);
  expect(mocks.getInventory).toHaveBeenCalledOnce();
  expect(secondRead).toHaveBeenCalledOnce();
  expect(second.headers.get('Cache-Control')).toBe('private, no-store');
});
