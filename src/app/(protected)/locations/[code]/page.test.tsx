import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ inventory: vi.fn(), redirect: vi.fn() }));
const location = {
  id: 'root',
  code: 'ITO',
  name: 'IT Office',
  breadcrumb: 'IT Office',
  active: true,
  can_hold_inventory: false,
  parentId: null,
  spaceRootCode: 'ITO',
};
vi.mock('@/features/inventory/queries.server', () => ({
  getLocation: async () => location,
  getLocations: async () => [
    location,
    {
      ...location,
      id: 'child',
      code: 'ITO-GENERAL',
      name: 'General Storage / Unsorted',
      breadcrumb: 'IT Office / General Storage / Unsorted',
      parentId: 'root',
      can_hold_inventory: true,
    },
  ],
  getInventory: m.inventory,
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: m.redirect }));
import Page from './page';
it('shows selected normalized scope and matching CSV, retaining filters and resetting page', async () => {
  m.inventory.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
  render(
    await Page({
      params: Promise.resolve({ code: 'ITO' }),
      searchParams: Promise.resolve({ status: 'all', q: 'Cable', page: '1' }),
    }),
  );
  expect(screen.getByRole('link', { name: 'All statuses' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Active only' })).toHaveAttribute(
    'href',
    '/locations/ITO?q=Cable',
  );
  expect(screen.queryByText(/Current scope:/)).not.toBeInTheDocument();
  const actions = screen.getByRole('navigation', { name: 'Location actions' });
  expect(within(actions).getAllByRole('link')).toHaveLength(4);
  expect(
    within(actions).getByRole('link', { name: 'Print label' }),
  ).toHaveAttribute('href', '/labels?location=ITO');
  expect(
    within(actions).getByRole('link', { name: 'History' }),
  ).toHaveAttribute('href', '/history?location=ITO');
  expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute(
    'href',
    '/api/exports/inventory?q=Cable&status=all&location=ITO&displayTimeZone=UTC',
  );
  expect(
    screen.queryByRole('navigation', { name: 'Pagination' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: /IT Office \/ General Storage/ }),
  ).toHaveTextContent('General Storage / Unsorted');
  expect(
    screen.getByRole('link', { name: /IT Office \/ General Storage/ }),
  ).not.toHaveTextContent('IT Office /');
});
vi.mock('server-only', () => ({}));
