import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import QuantityPage from '@/app/(protected)/inventory/quantity/[id]/page';
import AssetPage from '@/app/(protected)/inventory/assets/[id]/page';
import NewQuantityPage from '@/app/(protected)/inventory/quantity/new/page';
import NewAssetPage from '@/app/(protected)/inventory/assets/new/page';
import SiteOpeningPage from '@/app/(protected)/sites/[code]/open/[kind]/page';
vi.mock('server-only', () => ({}));
const fixture = vi.hoisted(() => ({
  role: 'viewer',
  forms: vi.fn(async (ids: string[]) => {
    void ids;
    return {};
  }),
  metadata: {
    id: 'item',
    name: 'Cable',
    description: null,
    categoryId: 'category',
    categoryName: 'Cables',
    manufacturer: null,
    model: null,
    version: 1,
  },
  location: {
    id: 'location',
    code: 'ITC-S1A',
    name: '1A',
    breadcrumb: 'IT Closet / 1A',
    active: true,
    can_hold_inventory: true,
    parentId: null,
  },
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({ member: { role: fixture.role } }),
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: fixture.forms,
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSites: async () => [],
  getSite: async () => ({
    id: 'site',
    code: 'SITE',
    name: 'Test site',
    active: true,
  }),
  getEntitySiteHoldings: async () => [],
  getEntityAssignments: async () => [],
}));
vi.mock('@/features/files/files-panel', () => ({
  FilesPanel: ({
    parentType,
    staff,
  }: {
    parentType: 'quantity' | 'asset';
    staff: boolean;
  }) => (
    <section
      aria-label={
        parentType === 'quantity' ? 'Quantity photo' : 'Asset attachments'
      }
    >
      {staff ? 'File controls' : 'Read-only files'}
    </section>
  ),
}));
vi.mock('../queries.server', () => ({
  getQuantityDetail: async () => ({
    item: {
      ...fixture.metadata,
      archived: false,
      itemCode: null,
      reorderThreshold: null,
    },
    stockSummary: {
      availableQuantity: '2',
      assignedQuantity: '0',
      ownedQuantity: '2',
      reorderThreshold: 3,
      stockState: 'needs_restocking',
    },
    balances: [{ location: fixture.location, quantity: 2 }],
    history: [],
  }),
  getAssetDetail: async () => ({
    asset: {
      ...fixture.metadata,
      status: 'active',
      assetTag: null,
      serialNumber: null,
    },
    location: fixture.location,
    site: null,
    history: [],
    duplicateSerialMatches: [],
  }),
  getQuantityArchiveReview: async () => null,
  getCategories: async () => [
    { id: 'category', name: 'Cables', active: true },
    { id: 'other', name: 'Other', active: true },
  ],
  getLocations: async () => [fixture.location],
}));
vi.mock('../actions', () => ({
  submitInventory: vi.fn(),
  findDuplicateSerials: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  notFound: () => {
    throw new Error('not found');
  },
}));
beforeEach(() => {
  fixture.role = 'viewer';
  fixture.forms.mockClear();
});
it.each(['quantity', 'asset'] as const)(
  '%s detail restores only a safe internal result scope',
  async (kind) => {
    const Page = kind === 'quantity' ? QuantityPage : AssetPage;
    const scope = '/inventory?q=USB&status=all&page=2';
    const first = render(
      await Page({
        params: Promise.resolve({ id: 'item' }),
        searchParams: Promise.resolve({ returnTo: scope }),
      }),
    );
    expect(
      screen.getByRole('link', { name: '← Back to results' }),
    ).toHaveAttribute('href', scope);
    first.unmount();
    render(
      await Page({
        params: Promise.resolve({ id: 'item' }),
        searchParams: Promise.resolve({ returnTo: '//evil.test' }),
      }),
    );
    expect(
      screen.getByRole('link', { name: '← Back to inventory' }),
    ).toHaveAttribute('href', '/inventory');
  },
);
it.each(['quantity', 'asset'] as const)(
  'viewer %s details retain read surfaces without task or write launchers',
  async (kind) => {
    const Page = kind === 'quantity' ? QuantityPage : AssetPage;
    render(await Page({ params: Promise.resolve({ id: 'item' }) }));
    expect(screen.getByRole('heading', { name: 'Cable' })).toBeVisible();
    if (kind === 'quantity') {
      expect(
        screen.getByText(/Needs restocking.*available in storage 2/),
      ).toBeVisible();
      expect(screen.getByText('Available in storage')).toBeVisible();
    } else expect(screen.getByText('Current custody')).toBeVisible();
    expect(
      screen.getByRole('link', {
        name:
          kind === 'quantity'
            ? 'View all item history'
            : 'View all asset history',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('region', {
        name: kind === 'quantity' ? 'Quantity photo' : 'Asset attachments',
      }),
    ).toBeVisible();
    expect(screen.getByText('Read-only files')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Record tasks' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /^(Receive stock|Move stock|Move asset|Edit details|Issue stock|Assign asset|Return to storage|Transfer between sites|Correct|Record existing|Archive|Restore|Retire|Write off)/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByText('File controls')).not.toBeInTheDocument();
    expect(fixture.forms).toHaveBeenCalledWith(['category']);
  },
);
it('staff pages fetch only the initially selected category form', async () => {
  fixture.role = 'staff';
  await NewQuantityPage();
  await NewAssetPage();
  await QuantityPage({ params: Promise.resolve({ id: 'item' }) });
  await AssetPage({ params: Promise.resolve({ id: 'item' }) });
  await SiteOpeningPage({
    params: Promise.resolve({ code: 'SITE', kind: 'quantity' }),
  });
  expect(fixture.forms).toHaveBeenCalledTimes(5);
  for (const [ids] of fixture.forms.mock.calls)
    expect(ids).toEqual(['category']);
});
it('lazy mounts metadata edit through the task launcher', async () => {
  fixture.role = 'staff';
  const page = render(
    await QuantityPage({ params: Promise.resolve({ id: 'item' }) }),
  );
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  expect(
    screen.getByRole('form', { name: 'Edit quantity metadata' }),
  ).toBeVisible();
  page.unmount();
  render(await AssetPage({ params: Promise.resolve({ id: 'item' }) }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  expect(
    screen.getByRole('form', { name: 'Edit asset metadata' }),
  ).toBeVisible();
});
