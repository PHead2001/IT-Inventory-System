vi.mock('server-only', () => ({}));
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { QuantityDetail } from '@/features/inventory/contracts-ui';
import QuantityPage from './page';

const mocks = vi.hoisted(() => ({ assignments: vi.fn(), role: 'viewer' }));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: { user_id: 'viewer', role: mocks.role },
  }),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getQuantityDetail: vi.fn(async (): Promise<QuantityDetail> => ({
    item: {
      id: 'item',
      name: 'Cable',
      categoryId: 'category',
      categoryName: 'Cables',
      description: null,
      manufacturer: null,
      model: null,
      version: 1,
      archived: false,
      itemCode: null,
      reorderThreshold: null,
    },
    balances: [],
    history: [],
    stockSummary: {
      availableQuantity: '0',
      assignedQuantity: '10',
      ownedQuantity: '10',
      reorderThreshold: null,
      stockState: 'disabled',
    },
  })),
  getCategories: async () => [],
  getLocations: async () => [],
  getQuantityArchiveReview: vi.fn(),
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSites: async () => [],
  getEntitySiteHoldings: async () => [],
  getEntityAssignments: mocks.assignments,
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: async () => ({}),
}));
vi.mock('@/features/inventory/components/detail-tasks', () => ({
  DetailTasks: () => (
    <section aria-label="Record tasks">
      <h2>Tasks</h2>
    </section>
  ),
}));
vi.mock('@/features/metadata/custom-metadata-list', () => ({
  CustomMetadataList: () => null,
}));
vi.mock('@/features/files/files-panel', () => ({
  FilesPanel: vi.fn(() => null),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

it('keeps a quantity correction distinct from custody movement in the record history', async () => {
  mocks.assignments.mockResolvedValue([
    {
      id: 'correction',
      kind: 'corrected',
      from_label: 'Historical site',
      to_label: null,
      quantity: 5,
      actor_name: 'Staff',
      created_at: '2026-10-07T12:00:00Z',
      reason: 'Count checked',
    },
  ]);
  render(await QuantityPage({ params: Promise.resolve({ id: 'item' }) }));
  const history = screen.getByRole('region', { name: 'Custody history' });
  expect(history).toHaveTextContent('Count corrected at Historical site');
  expect(history).toHaveTextContent('Reason: Count checked');
  expect(history).not.toHaveTextContent('→');
  expect(history).not.toHaveTextContent('No destination');
  expect(history).not.toHaveTextContent('5 units');
});
vi.mock('server-only', () => ({}));

it('places staff tasks before supporting item details and the optional storage preview', async () => {
  mocks.role = 'staff';
  mocks.assignments.mockResolvedValue([]);
  render(await QuantityPage({ params: Promise.resolve({ id: 'item' }) }));
  const tasks = screen.getByRole('region', { name: 'Record tasks' });
  const preview = screen.getByRole('region', { name: 'Storage preview' });
  const details = screen.getByRole('heading', { name: 'Item details' });
  expect(
    tasks.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    tasks.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  mocks.role = 'viewer';
});

vi.mock('@/features/files/cards.server', () => ({
  getInventoryFileCards: vi.fn(async () => ({
    status: 'ready',
    envelope: { revision: '17', files: [] },
  })),
}));

it('passes typed server file state while keeping core detail usable on unavailability and propagating authorization failure', async () => {
  const { getInventoryFileCards } =
    await import('@/features/files/cards.server');
  const { FilesPanel } = await import('@/features/files/files-panel');
  const Page = QuantityPage;
  const parentId = 'quantity';
  const view = render(
    await Page({ params: Promise.resolve({ id: parentId }) }),
  );
  expect(getInventoryFileCards).toHaveBeenCalledWith('quantity', parentId);
  expect(FilesPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      initialState: {
        status: 'ready',
        envelope: { revision: '17', files: [] },
      },
    }),
    undefined,
  );
  view.unmount();
  vi.mocked(getInventoryFileCards).mockResolvedValueOnce({
    status: 'unavailable',
  });
  render(await Page({ params: Promise.resolve({ id: parentId }) }));
  expect(screen.getByRole('heading', { name: 'Cable' })).toBeVisible();
  expect(FilesPanel).toHaveBeenLastCalledWith(
    expect.objectContaining({ initialState: { status: 'unavailable' } }),
    undefined,
  );
  vi.mocked(getInventoryFileCards).mockRejectedValueOnce(
    new Error('Membership denied'),
  );
  await expect(
    Page({ params: Promise.resolve({ id: parentId }) }),
  ).rejects.toThrow('Membership denied');
});

it.each([
  [false, '25', 30, 'needs_restocking', '5 below threshold'],
  [false, '30', 30, 'needs_restocking', 'At threshold'],
  [false, '0', 0, 'out_of_stock', 'At threshold'],
  [false, '31', 30, 'in_stock', null],
  [false, '0', null, 'disabled', null],
  [true, '0', 30, 'needs_restocking', null],
] as const)(
  'shows current shortfall only for eligible active detail (archived %s, available %s, threshold %s)',
  async (
    archived,
    availableQuantity,
    reorderThreshold,
    stockState,
    expected,
  ) => {
    const { getQuantityDetail } =
      await import('@/features/inventory/queries.server');
    const baseline = (await getQuantityDetail('item'))!;
    vi.mocked(getQuantityDetail).mockResolvedValueOnce({
      ...baseline,
      item: { ...baseline.item, archived, reorderThreshold },
      stockSummary: {
        ...baseline.stockSummary,
        availableQuantity,
        assignedQuantity: '0',
        ownedQuantity: availableQuantity,
        reorderThreshold,
        stockState,
      },
    });
    const view = render(
      await QuantityPage({ params: Promise.resolve({ id: 'item' }) }),
    );
    if (expected === null)
      expect(view.container).not.toHaveTextContent(
        /below threshold|At threshold/,
      );
    else expect(screen.getByText(new RegExp(expected))).toBeVisible();
    if (stockState === 'in_stock')
      expect(screen.getByText(/Above threshold/)).toBeVisible();
    if (archived)
      expect(view.container).not.toHaveTextContent(
        /Needs restocking|Out of stock/,
      );
    if (reorderThreshold === null)
      expect(screen.getByText('Monitoring disabled')).toBeVisible();
  },
);
