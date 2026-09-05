import { render, screen, cleanup } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import QuantityPage from '@/app/(protected)/inventory/quantity/[id]/page';
import AssetPage from '@/app/(protected)/inventory/assets/[id]/page';
const fixture = vi.hoisted(() => ({
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
  requireMember: async () => ({ member: { role: 'viewer' } }),
}));
vi.mock('../queries.server', () => ({
  getQuantityDetail: async () => ({
    item: { ...fixture.metadata, archived: false },
    balances: [],
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
    history: [],
    duplicateSerialMatches: [],
  }),
  getCategories: async () => [],
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
it('viewers can read both detail types and history links without mutation panels', async () => {
  render(await QuantityPage({ params: Promise.resolve({ id: 'item' }) }));
  expect(screen.getByRole('heading', { name: 'Cable' })).toBeVisible();
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
});
