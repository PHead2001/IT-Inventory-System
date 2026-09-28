import { beforeEach, expect, it, vi } from 'vitest';
import type { LocationRef } from '@/features/inventory/contracts-ui';
const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  getLocations: vi.fn(),
  getInventory: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getLocations: mocks.getLocations,
  getInventory: mocks.getInventory,
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
  mocks.requireMember.mockResolvedValue({ member: { user_id: 'test' } });
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
  mocks.requireMember.mockRejectedValue(new Error('access denied'));
  await expect(GET(request('location=ITC-D01'))).rejects.toThrow(
    'access denied',
  );
  expect(mocks.getInventory).not.toHaveBeenCalled();
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
});
