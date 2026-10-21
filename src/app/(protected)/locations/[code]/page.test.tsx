// Protected page readiness receives the same mocked request actor as its reads.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: {
      user_id: 'route-test-actor',
      role: 'staff',
      can_manage_configuration: true,
    },
  }),
}));
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

const scopedOrigin =
  '/locations?q=Office&selected=ITO&level=&expanded=ITO#location-row-selected-panel-00000000-0000-4000-8000-000000000001';

it('retains the validated browser origin through status, pagination and child detail navigation while export keeps inventory filters', async () => {
  m.inventory.mockResolvedValue({
    rows: Array.from({ length: 25 }, (_, index) => ({
      kind: 'asset',
      id: `asset-${index}`,
      name: `Descendant asset ${index + 1}`,
      categoryName: 'Equipment',
      status: 'active',
      location: {
        ...location,
        id: 'child',
        code: 'ITO-GENERAL',
        name: 'General Storage / Unsorted',
        breadcrumb: 'IT Office / General Storage / Unsorted',
        parentId: 'root',
        can_hold_inventory: true,
      },
      quantity: null,
      assetTag: null,
      serialNumber: null,
      recordedTotal: null,
      reorderThreshold: null,
      stockState: null,
    })),
    total: 75,
    page: 2,
    pageSize: 25,
  });
  render(
    await Page({
      params: Promise.resolve({ code: 'ITO' }),
      searchParams: Promise.resolve({
        returnTo: scopedOrigin,
        status: 'all',
        q: 'Cable',
        page: '2',
      }),
    }),
  );
  // The child card and all 25 descendant holdings share an accessible
  // location name. Only the child card retains the browser return scope.
  const childName = 'IT Office / General Storage / Unsorted (ITO-GENERAL)';
  expect(screen.getAllByRole('link', { name: childName })).toHaveLength(26);
  const childSection = screen
    .getByRole('heading', { name: 'Child locations' })
    .closest('section')!;
  const childLink = within(childSection).getByRole('link', {
    name: childName,
  });
  const navigation = [
    screen.getByRole('link', { name: 'Active only' }),
    screen.getByRole('link', { name: 'All statuses' }),
    screen.getByRole('link', { name: 'Previous' }),
    screen.getByRole('link', { name: 'Next' }),
    childLink,
  ];
  for (const link of navigation) {
    const target = new URL(
      link.getAttribute('href')!,
      'https://inventory.invalid',
    );
    expect(target.searchParams.get('returnTo')).toBe(scopedOrigin);
  }
  const active = new URL(
    navigation[0].getAttribute('href')!,
    'https://inventory.invalid',
  );
  expect(active.searchParams.get('q')).toBe('Cable');
  expect(active.searchParams.has('page')).toBe(false);
  const previous = new URL(
    navigation[2].getAttribute('href')!,
    'https://inventory.invalid',
  );
  expect(previous.searchParams.get('page')).toBe('1');
  const child = new URL(
    navigation[4].getAttribute('href')!,
    'https://inventory.invalid',
  );
  expect(child.pathname).toBe('/locations/ITO-GENERAL');
  const exported = new URL(
    screen.getByRole('link', { name: 'Export' }).getAttribute('href')!,
    'https://inventory.invalid',
  );
  expect(exported.searchParams.has('returnTo')).toBe(false);
  expect(exported.searchParams.get('location')).toBe('ITO');
  expect(exported.searchParams.get('status')).toBe('all');
});

it.each([scopedOrigin, '/history?type=asset', '//outside.example/locations'])(
  'page recovery carries only the validated origin from %s',
  async (origin) => {
    m.redirect.mockClear();
    m.inventory.mockResolvedValue({
      rows: [],
      total: 50,
      page: 99,
      pageSize: 25,
    });
    await Page({
      params: Promise.resolve({ code: 'ITO' }),
      searchParams: Promise.resolve({
        returnTo: origin,
        status: 'all',
        q: 'Cable',
        page: '99',
      }),
    });
    expect(m.redirect).toHaveBeenCalledOnce();
    const recovery = new URL(
      m.redirect.mock.calls[0][0],
      'https://inventory.invalid',
    );
    expect(recovery.pathname).toBe('/locations/ITO');
    expect(recovery.searchParams.get('page')).toBe('2');
    expect(recovery.searchParams.get('q')).toBe('Cable');
    expect(recovery.searchParams.get('returnTo')).toBe(
      origin === scopedOrigin ? scopedOrigin : '/locations',
    );
  },
);
it('All locations retains only a bounded locations detail origin', async () => {
  m.inventory.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
  const origin =
    '/locations?q=Office&selected=ITO&level=&expanded=ITO#location-row-selected-panel-00000000-0000-4000-8000-000000000001';
  const page = render(
    await Page({
      params: Promise.resolve({ code: 'ITO' }),
      searchParams: Promise.resolve({ returnTo: origin }),
    }),
  );
  expect(screen.getByRole('link', { name: 'All locations' })).toHaveAttribute(
    'href',
    origin,
  );
  page.rerender(
    await Page({
      params: Promise.resolve({ code: 'ITO' }),
      searchParams: Promise.resolve({ returnTo: '/history?type=asset' }),
    }),
  );
  expect(screen.getByRole('link', { name: 'All locations' })).toHaveAttribute(
    'href',
    '/locations',
  );
});
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
