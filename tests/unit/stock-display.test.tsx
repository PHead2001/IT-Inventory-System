import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quantity: vi.fn(),
  holdings: vi.fn(),
  assignments: vi.fn(),
  siteDetail: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: { role: 'viewer', can_manage_configuration: false },
  }),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getQuantityDetail: mocks.quantity,
  getQuantityArchiveReview: vi.fn(),
  getCategories: async () => [],
  getLocations: async () => [],
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSites: async () => [],
  getEntitySiteHoldings: mocks.holdings,
  getEntityAssignments: mocks.assignments,
  getSite: async () => ({
    id: 'site',
    name: 'Remote office',
    code: 'HQ',
    active: true,
  }),
  getSiteDetail: mocks.siteDetail,
  getSiteArchiveReview: vi.fn(),
}));
vi.mock('@/features/inventory/components/mutation-form', () => ({
  OperationPanel: () => null,
}));
vi.mock('@/features/metadata/metadata-form', () => ({
  MetadataForm: () => null,
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: vi.fn(),
}));
vi.mock('@/features/inventory/components/archive-quantity-form', () => ({
  ArchiveQuantityPanel: () => null,
}));
vi.mock('@/features/custody/custody-change-form', () => ({
  CustodyChangeForm: () => null,
}));
vi.mock('@/features/custody/management-form', () => ({
  SiteManagementForm: () => null,
}));
vi.mock('@/features/files/files-panel', () => ({ FilesPanel: () => null }));
import QuantityPage from '@/app/(protected)/inventory/quantity/[id]/page';
import SitePage from '@/app/(protected)/sites/[code]/page';

const location = {
  id: 'location',
  name: 'Red container',
  code: 'ITC-RED',
  breadcrumb: 'IT Closet / Red container',
  active: true,
  canHoldInventory: true,
};
beforeEach(() => vi.clearAllMocks());

it.each([1, 2])(
  'quantity detail keeps stock and custody quantities intact while formatting %s units',
  async (quantity) => {
    const label = `${quantity} ${quantity === 1 ? 'unit' : 'units'}`;
    mocks.quantity.mockResolvedValue({
      item: {
        id: 'item',
        name: 'Adapters',
        categoryName: 'Cables',
        categoryId: 'category',
        version: 1,
        archived: false,
        customDisplay: [],
      },
      balances: [{ location, quantity }],
      history: [],
      stockSummary: {
        availableQuantity: String(quantity),
        assignedQuantity: String(quantity),
        ownedQuantity: String(quantity),
        reorderThreshold: quantity,
        stockState: 'in_stock',
      },
    });
    mocks.holdings.mockResolvedValue([
      {
        site_id: 'site',
        site_code: 'HQ',
        site_name: 'Remote office',
        site_active: true,
        quantity,
      },
    ]);
    mocks.assignments.mockResolvedValue([
      {
        id: 'assignment',
        kind: 'quantity_issue',
        from_label: 'Storage',
        to_label: 'Remote office',
        quantity,
        actor_name: 'IT Staff',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    render(await QuantityPage({ params: Promise.resolve({ id: 'item' }) }));
    for (const name of [
      'Available in storage',
      'Assigned to sites',
      'Total recorded',
      'Reorder threshold',
    ])
      expect(screen.getByText(name).nextElementSibling).toHaveTextContent(
        new RegExp(label + '\\b'),
      );
    expect(
      screen
        .getByRole('link', { name: 'IT Closet / Red container (ITC-RED)' })
        .closest('li'),
    ).toHaveTextContent(new RegExp(label + '\\b'));
    expect(
      screen.getByRole('link', { name: 'Remote office (HQ)' }).parentElement,
    ).toHaveTextContent(new RegExp(label + '\\b'));
    expect(
      within(screen.getByRole('region', { name: 'Custody history' })).getByText(
        /Storage → Remote office/,
      ),
    ).toHaveTextContent(new RegExp(label + '\\b'));
  },
);

it.each([1, 2])(
  'site holdings and assignment history retain %s quantity with correct units',
  async (quantity) => {
    const label = `${quantity} ${quantity === 1 ? 'unit' : 'units'}`;
    mocks.siteDetail.mockResolvedValue({
      summary: {
        current_quantity_units: String(quantity),
        current_serialized_assets: '0',
        quantity: {},
        serialized: {},
      },
      groups: {
        rows: [
          {
            inventory_kind: 'quantity',
            category_name: 'Cables',
            name: 'Adapters',
            quantity_units: String(quantity),
            serialized_devices: null,
          },
          {
            inventory_kind: 'asset',
            category_name: 'Computers',
            name: 'Laptops',
            quantity_units: null,
            serialized_devices: String(quantity),
          },
        ],
        total: 2,
      },
      holdings: [
        {
          inventory_kind: 'quantity',
          entity_id: 'item',
          name: 'Adapters',
          category_name: 'Cables',
          quantity,
        },
      ],
      holdingTotal: 1,
      page: 1,
      events: [
        {
          id: 'assignment',
          kind: 'quantity_issue',
          item_id: 'item',
          quantity,
          actor_name: 'IT Staff',
          created_at: '2026-01-01T00:00:00Z',
          from_label: 'Storage',
          to_label: 'Remote office',
        },
      ],
    });
    render(
      await SitePage({
        params: Promise.resolve({ code: 'HQ' }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole('link', { name: 'Adapters' }).parentElement,
    ).toHaveTextContent(new RegExp(label + '\\b'));
    expect(screen.getByText(/Storage → Remote office/)).toHaveTextContent(
      new RegExp(label + '\\b'),
    );
    const groups = screen.getByRole('region', {
      name: 'Grouped current holdings',
    });
    expect(
      within(groups).getByText(
        `${quantity} quantity unit${quantity === 1 ? '' : 's'}`,
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      within(groups).getByText(
        `${quantity} distinct serialized device${quantity === 1 ? '' : 's'}`,
        { exact: true },
      ),
    ).toBeVisible();
  },
);
