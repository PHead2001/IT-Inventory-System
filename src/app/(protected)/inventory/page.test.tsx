import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  getInventory: vi.fn(),
  hasRecordedInventory: vi.fn(),
  redirect: vi.fn(),
  getCategories: vi.fn(),
  getLocations: vi.fn(),
  getSites: vi.fn(),
  getFileListSummaries: vi.fn(),
  searchForm: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getInventory: mocks.getInventory,
  hasRecordedInventory: mocks.hasRecordedInventory,
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
  SearchForm: mocks.searchForm,
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import InventoryPage from './page';
import { RouteReady } from '@/components/experience/route-ready';
import { InventoryRows } from '@/features/inventory/components/read-ui';
import { routeKey, type RouteQuery } from '@/components/experience/route-key';
import { Children, isValidElement, type ReactNode } from 'react';

const result = { rows: [], total: 0, page: 1, pageSize: 25 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AUTH_DIAGNOSTICS', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  mocks.requireMember.mockResolvedValue({ member: { role: 'staff' } });
  mocks.getInventory.mockResolvedValue(result);
  mocks.hasRecordedInventory.mockResolvedValue(false);
  mocks.getCategories.mockResolvedValue([]);
  mocks.getLocations.mockResolvedValue([]);
  mocks.getSites.mockResolvedValue([]);
  mocks.getFileListSummaries.mockResolvedValue([]);
});

function findElement(
  node: ReactNode,
  type: unknown,
): React.ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === type) return child;
    const found = findElement(child.props.children as ReactNode, type);
    if (found) return found;
  }
}
it.each([
  [{ type: 'all' }, '/inventory'],
  [{ status: 'active' }, '/inventory'],
  [{ q: '  USB  ' }, '/inventory?q=USB'],
  [{ scopeAdjusted: 'true' }, '/inventory'],
  [{ page: '0' }, '/inventory?page=1'],
  [
    {
      type: 'all',
      status: 'active',
      q: ['  USB  ', 'ignored duplicate'],
      scopeAdjusted: 'true',
      page: '2',
    },
    '/inventory?q=USB&page=2',
  ],
] satisfies Array<[RouteQuery, string]>)(
  'binds canonical row-return scope separately from raw readiness for %j',
  async (raw, canonical) => {
    vi.stubEnv('AUTH_DIAGNOSTICS', '0');
    mocks.requireMember.mockResolvedValue({
      member: { user_id: 'actor', role: 'viewer' },
    });
    // Page two must be a real current page, so this case does not take recovery.
    mocks.getInventory.mockResolvedValue({
      ...result,
      total: 60,
      page: 'page' in raw && raw.page === '2' ? 2 : 1,
    });
    const page = await InventoryPage({ searchParams: Promise.resolve(raw) });
    const primary = findElement(page, RouteReady)!;
    const rows = findElement(page, InventoryRows)!;
    expect(primary.props.routeKey).toBe(routeKey('/inventory', raw));
    expect(primary.props.pairingHref).toBe(canonical);
    expect(rows.props.returnTo).toBe(canonical);
    expect(page.props.routeKey).toBe(routeKey('/inventory', raw));
  },
);
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

it('passes only the nonproduction diagnostic gate to the search client island', async () => {
  const preview = render(
    await InventoryPage({ searchParams: Promise.resolve({}) }),
  );
  expect(mocks.searchForm.mock.calls.at(-1)?.[0].diagnosticsEnabled).toBe(true);
  preview.unmount();

  vi.stubEnv('VERCEL_ENV', 'production');
  render(await InventoryPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.searchForm.mock.calls.at(-1)?.[0].diagnosticsEnabled).toBe(
    false,
  );
});

it('uses an authorized presence probe only for unfiltered empty inventory', async () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '0');
  mocks.requireMember.mockResolvedValue({ member: { role: 'viewer' } });
  const { rerender } = render(
    await InventoryPage({ searchParams: Promise.resolve({}) }),
  );
  expect(screen.getByText('No inventory has been recorded yet.')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Add quantity item' }),
  ).not.toBeInTheDocument();
  expect(mocks.hasRecordedInventory).toHaveBeenCalledOnce();
  mocks.hasRecordedInventory.mockResolvedValue(true);
  rerender(await InventoryPage({ searchParams: Promise.resolve({}) }));
  expect(
    screen.getByText('No active inventory. Historical records are available.'),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Include all statuses' }),
  ).toHaveAttribute('href', '/inventory?status=all');
});
it('does not infer catalog emptiness from a filtered page or convert probe failure into absence', async () => {
  vi.stubEnv('AUTH_DIAGNOSTICS', '0');
  render(
    await InventoryPage({ searchParams: Promise.resolve({ q: 'missing' }) }),
  );
  expect(mocks.hasRecordedInventory).not.toHaveBeenCalled();
  expect(screen.getByText('No inventory matches these filters.')).toBeVisible();
  mocks.hasRecordedInventory.mockRejectedValue(
    new Error('Inventory presence could not be loaded.'),
  );
  await expect(
    InventoryPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow('Inventory presence could not be loaded.');
});

it('explains both tracking choices before entry and preserves the selected inventory return context', async () => {
  mocks.requireMember.mockResolvedValue({ member: { role: 'staff' } });
  render(
    await InventoryPage({
      searchParams: Promise.resolve({
        q: 'adapter',
        type: 'quantity',
        page: '2',
      }),
    }),
  );
  expect(screen.getByText('Add item').closest('details')).not.toHaveAttribute(
    'open',
  );
  fireEvent.click(screen.getByText('Add item'));
  const quantity = screen.getByRole('link', { name: 'Add quantity item' });
  const asset = screen.getByRole('link', { name: 'Add individual asset' });
  expect(quantity).toHaveAccessibleDescription(
    'Track interchangeable items by count, such as cables and adapters.',
  );
  expect(asset).toHaveAccessibleDescription(
    'Track one specific device, such as a laptop or switch.',
  );
  for (const [link, path] of [
    [quantity, '/inventory/quantity/new'],
    [asset, '/inventory/assets/new'],
  ] as const) {
    const url = new URL(
      link.getAttribute('href')!,
      'https://inventory.example.test',
    );
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('returnTo')).toBe(
      '/inventory?q=adapter&type=quantity&page=2',
    );
  }
});
