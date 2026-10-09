import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '@/features/inventory/contracts-ui';
const m = vi.hoisted(() => ({
  event: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('Not found');
  }),
}));
vi.mock('@/features/inventory/history-event.server', () => ({
  getHistoryEvent: m.event,
}));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
import Page from './page';
const event: HistoryEvent = {
  id: 'event',
  kind: 'asset',
  entityId: 'asset',
  entityName: 'Switch',
  eventType: 'metadata_updated',
  at: '2026-10-07T12:00:00Z',
  actorName: 'Recorded staff',
  reason: 'Recorded reason',
  assignment: null,
  fromLocation: null,
  toLocation: null,
  lines: [],
  metadataChanges: [{ field: 'Name', before: 'Old switch', after: 'Switch' }],
  customMetadataPresent: true,
  customMetadataChanged: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.event.mockResolvedValue(event);
});
it('renders the exact event with full record navigation and preserved custom snapshot access', async () => {
  render(
    await Page({ params: Promise.resolve({ kind: 'asset', id: 'event' }) }),
  );
  expect(m.event).toHaveBeenCalledExactlyOnceWith('asset', 'event');
  expect(
    screen.getByRole('heading', { name: 'Details updated' }),
  ).toBeVisible();
  expect(screen.getByText('Old switch → Switch')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'View all record history' }),
  ).toHaveAttribute('href', '/history?type=asset&entityId=asset');
  expect(screen.getByRole('link', { name: 'Back to record' })).toHaveAttribute(
    'href',
    '/inventory/assets/asset',
  );
  expect(
    screen.getByRole('link', { name: /Custom metadata changed/ }),
  ).toHaveAttribute('href', '/history?event=asset:event');
});
it.each(['unavailable', 'invalid'])(
  'does not substitute broad history for an %s event identity',
  async (id) => {
    m.event.mockResolvedValue(null);
    await expect(
      Page({ params: Promise.resolve({ kind: 'asset', id }) }),
    ).rejects.toThrow('Not found');
    expect(m.notFound).toHaveBeenCalledOnce();
  },
);
it('propagates a read failure without a false not-found result', async () => {
  m.event.mockRejectedValue(new Error('History unavailable'));
  await expect(
    Page({ params: Promise.resolve({ kind: 'asset', id: 'event' }) }),
  ).rejects.toThrow('History unavailable');
  expect(m.notFound).not.toHaveBeenCalled();
});
