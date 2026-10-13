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
  getQuantityDetail: async (): Promise<QuantityDetail> => ({
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
  }),
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
vi.mock('@/features/files/files-panel', () => ({ FilesPanel: () => null }));
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

it('places staff tasks before the optional storage preview', async () => {
  mocks.role = 'staff';
  mocks.assignments.mockResolvedValue([]);
  render(await QuantityPage({ params: Promise.resolve({ id: 'item' }) }));
  const tasks = screen.getByRole('region', { name: 'Record tasks' });
  const preview = screen.getByRole('region', { name: 'Storage preview' });
  expect(
    tasks.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  mocks.role = 'viewer';
});
