import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  getInventory: vi.fn(),
  getCategories: vi.fn(),
  getLocations: vi.fn(),
  getSites: vi.fn(),
  getFileListSummaries: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getInventory: mocks.getInventory,
  getCategories: mocks.getCategories,
  getLocations: mocks.getLocations,
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSites: mocks.getSites,
}));
vi.mock('@/features/files/list.server', () => ({
  getFileListSummaries: mocks.getFileListSummaries,
}));
vi.mock('@/features/inventory/components/search-form', () => ({
  SearchForm: () => null,
}));

import InventoryPage from './page';

const result = { rows: [], total: 0, page: 1, pageSize: 25 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  mocks.requireMember.mockResolvedValue({ member: { role: 'staff' } });
  mocks.getInventory.mockResolvedValue(result);
  mocks.getCategories.mockResolvedValue([]);
  mocks.getLocations.mockResolvedValue([]);
  mocks.getSites.mockResolvedValue([]);
  mocks.getFileListSummaries.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('times concurrent inventory reads and waits for their result before file summaries', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  let releaseInventory: (value: typeof result) => void = () => {};
  mocks.getInventory.mockReturnValue(
    new Promise<typeof result>((resolve) => {
      releaseInventory = resolve;
    }),
  );
  const page = InventoryPage({ searchParams: Promise.resolve({}) });
  await vi.waitFor(() => {
    expect(mocks.getInventory).toHaveBeenCalledOnce();
    expect(mocks.getCategories).toHaveBeenCalledOnce();
    expect(mocks.getLocations).toHaveBeenCalledOnce();
    expect(mocks.getSites).toHaveBeenCalledOnce();
  });
  expect(mocks.getFileListSummaries).not.toHaveBeenCalled();
  releaseInventory(result);
  await page;
  expect(mocks.getFileListSummaries).toHaveBeenCalledWith(result.rows);
  const events = info.mock.calls.map(([line]) =>
    JSON.parse(String(line).slice('AUTH_DIAGNOSTIC '.length)),
  );
  expect(events.map((event) => event.stage).sort()).toEqual(
    [
      'inventory.pageMembership',
      'inventory.search',
      'inventory.categories',
      'inventory.locations',
      'inventory.sites',
      'inventory.parallelReads',
      'inventory.fileSummaries',
    ].sort(),
  );
  expect(new Set(events.map((event) => event.correlation)).size).toBe(1);
  expect(info.mock.calls.flat().join(' ')).not.toContain('user_id');
});

it('propagates the original inventory error without reading file summaries', async () => {
  const original = new Error('original inventory failure');
  vi.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('observer failed');
  });
  mocks.getInventory.mockRejectedValue(original);
  await expect(
    InventoryPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toBe(original);
  expect(mocks.getFileListSummaries).not.toHaveBeenCalled();
});
