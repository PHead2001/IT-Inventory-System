import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  history: vi.fn(),
  identity: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getHistory: m.history,
  getHistoryRecord: m.identity,
  getLocations: async () => [],
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getEventCustomPage: vi.fn(),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: m.redirect }));
import Page from './page';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  m.history.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
  m.identity.mockResolvedValue({ id, name: 'Adapters', kind: 'quantity' });
});
it('locks the actual record kind, explains contradiction and preserves location when clearing', async () => {
  render(
    await Page({
      searchParams: Promise.resolve({
        entityId: id,
        type: 'asset',
        location: 'ITC-BLACK',
      }),
    }),
  );
  expect(m.history).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'quantity', entityId: id }),
  );
  expect(
    screen.getByRole('combobox', { name: 'Tracking type' }),
  ).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Tracking type' })).toHaveValue(
    'quantity',
  );
  expect(screen.getByRole('link', { name: 'Adapters' })).toHaveAttribute(
    'href',
    '/inventory/quantity/' + id,
  );
  expect(screen.getByText(/Tracking type was reconciled/)).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Clear record filter' }),
  ).toHaveAttribute('href', '/history?type=quantity&location=ITC-BLACK');
});
it('does not query broad history when the supplied record is unavailable or malformed', async () => {
  m.identity.mockResolvedValue(null);
  render(
    await Page({
      searchParams: Promise.resolve({
        entityId: 'invalid',
        location: 'ITC-BLACK',
      }),
    }),
  );
  expect(m.history).not.toHaveBeenCalled();
  expect(screen.getByText(/Record history is unavailable/)).toBeVisible();
  expect(
    screen.queryByText('No history matches these filters.'),
  ).not.toBeInTheDocument();
});
it('keeps a failed identity read unavailable without querying history', async () => {
  m.identity.mockRejectedValueOnce(
    new Error('Record identity could not be loaded.'),
  );
  await expect(
    Page({ searchParams: Promise.resolve({ entityId: id }) }),
  ).rejects.toThrow('Record identity could not be loaded.');
  expect(m.history).not.toHaveBeenCalled();
});
it('updates the locked kind when browser navigation restores a record after changing general type', async () => {
  const { rerender } = render(
    await Page({ searchParams: Promise.resolve({ type: 'asset' }) }),
  );
  expect(screen.getByRole('combobox', { name: 'Tracking type' })).toHaveValue(
    'asset',
  );
  rerender(
    await Page({
      searchParams: Promise.resolve({ entityId: id, type: 'quantity' }),
    }),
  );
  expect(
    screen.getByRole('combobox', { name: 'Tracking type' }),
  ).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Tracking type' })).toHaveValue(
    'quantity',
  );
});
