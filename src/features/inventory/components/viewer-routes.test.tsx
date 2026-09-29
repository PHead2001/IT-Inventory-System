import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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
  FilesPanel: () => null,
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
  notFound: () => {
    throw new Error('not found');
  },
}));
beforeEach(() => {
  fixture.role = 'viewer';
  fixture.forms.mockClear();
});
it('viewers can read both detail types and history links without mutation panels', async () => {
  render(await QuantityPage({ params: Promise.resolve({ id: 'item' }) }));
  expect(screen.getByRole('heading', { name: 'Cable' })).toBeVisible();
  expect(
    screen.getByText(/Needs restocking.*available in storage 2/),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'View all item history' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Quantity actions' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Manage quantity inventory'),
  ).not.toBeInTheDocument();
  cleanup();
  render(await AssetPage({ params: Promise.resolve({ id: 'item' }) }));
  expect(screen.getByRole('heading', { name: 'Cable' })).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'View all asset history' }),
  ).toBeVisible();
  expect(screen.queryByText('Manage serialized asset')).not.toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(fixture.forms).not.toHaveBeenCalled();
});
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
it('keeps metadata edit form mounted inside a discoverable disclosure', async () => {
  fixture.role = 'staff';
  const page = render(
    await QuantityPage({ params: Promise.resolve({ id: 'item' }) }),
  );
  const summary = screen.getByText('Edit quantity metadata', {
    selector: 'summary',
  });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
  expect(
    screen.getByRole('form', { name: 'Edit quantity metadata' }),
  ).toBeVisible();
  page.unmount();
  render(await AssetPage({ params: Promise.resolve({ id: 'item' }) }));
  const assetSummary = screen.getByText('Edit asset metadata', {
    selector: 'summary',
  });
  fireEvent.click(assetSummary);
  expect(
    screen.getByRole('form', { name: 'Edit asset metadata' }),
  ).toBeVisible();
});
