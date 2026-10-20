vi.mock('server-only', () => ({}));
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type {
  AssetDetail,
  HistoryEvent,
} from '@/features/inventory/contracts-ui';
import AssetPage from './page';

const memberState = vi.hoisted(() => ({ role: 'viewer' }));
const custodyEvent: HistoryEvent = {
  id: 'issued-first',
  kind: 'asset',
  entityId: 'asset',
  entityName: 'Switch',
  eventType: 'site_assigned',
  at: '2026-10-07T12:00:00Z',
  actorName: 'Recorded staff',
  reason: 'Ticket assignment',
  assignment: {
    eventId: 'assignment-first',
    kind: 'issued',
    from: { locationId: 'storage', siteId: null, label: 'Original storage' },
    to: { locationId: null, siteId: 'site', label: 'Original site' },
    quantity: null,
    reference: 'TICKET-1',
  },
  lines: [],
  fromLocation: null,
  toLocation: null,
  metadataChanges: [],
  customMetadataPresent: false,
  customMetadataChanged: false,
};
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: { user_id: 'viewer', role: memberState.role },
  }),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getAssetDetail: async (): Promise<AssetDetail> => ({
    asset: {
      id: 'asset',
      name: 'Switch',
      categoryId: 'category',
      categoryName: 'Networking',
      description: null,
      manufacturer: null,
      model: null,
      version: 3,
      status: 'active',
      assetTag: 'SW-1',
      serialNumber: null,
    },
    location: null,
    site: { id: 'site', code: 'SITE-1', name: 'Current site' },
    // Distinct real operations can share text and time; never collapse by presentation.
    history: [
      custodyEvent,
      {
        ...custodyEvent,
        id: 'issued-second',
        assignment: {
          ...custodyEvent.assignment!,
          eventId: 'assignment-second',
        },
      },
    ],
    duplicateSerialMatches: [],
  }),
  getCategories: async () => [],
  getLocations: async () => [],
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSites: async () => [],
  getAssetReturnSuggestion: async () => undefined,
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

it('renders one authoritative asset timeline without duplicating custody or merging separate events', async () => {
  render(await AssetPage({ params: Promise.resolve({ id: 'asset' }) }));
  expect(
    screen.queryByRole('region', { name: 'Custody history' }),
  ).not.toBeInTheDocument();
  const timeline = screen.getByRole('region', { name: 'Recent history' });
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
  expect(
    within(timeline).getAllByRole('heading', { name: 'Assigned to site' }),
  ).toHaveLength(2);
  expect(
    within(timeline).getAllByText('Original storage → Original site'),
  ).toHaveLength(2);
  expect(
    within(timeline)
      .getAllByRole('link', { name: 'Open recorded event' })
      .map((link) => link.getAttribute('href')),
  ).toEqual([
    '/history/events/asset/issued-first',
    '/history/events/asset/issued-second',
  ]);
  fireEvent.click(within(timeline).getAllByText('View event details')[0]);
  expect(
    within(timeline).getAllByText('Ticket number reference: TICKET-1')[0],
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'View all asset history' }),
  ).toHaveAttribute('href', '/history?type=asset&entityId=asset');
  expect(
    screen.getByRole('link', { name: 'Current site (SITE-1)' }),
  ).toBeVisible();
});
vi.mock('server-only', () => ({}));

it('places staff tasks before supporting asset details and the optional storage preview even for site custody', async () => {
  memberState.role = 'staff';
  render(await AssetPage({ params: Promise.resolve({ id: 'asset' }) }));
  const tasks = screen.getByRole('region', { name: 'Record tasks' });
  const preview = screen.getByRole('region', { name: 'Storage preview' });
  const details = screen.getByRole('heading', { name: 'Asset details' });
  expect(
    tasks.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    tasks.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  memberState.role = 'viewer';
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
  const Page = AssetPage;
  const parentId = 'asset';
  const view = render(
    await Page({ params: Promise.resolve({ id: parentId }) }),
  );
  expect(getInventoryFileCards).toHaveBeenCalledWith('asset', parentId);
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
  expect(screen.getByRole('heading', { name: 'Switch' })).toBeVisible();
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
