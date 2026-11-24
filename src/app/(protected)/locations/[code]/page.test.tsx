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
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  inventory: vi.fn(),
  columns: vi.fn(async () => ({ fields: [], truncated: false })),
  redirect: vi.fn(),
  viewControls: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));
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
vi.mock('@/features/inventory/views.server', () => ({
  getInventoryColumns: m.columns,
  getInventoryView: async (input: Record<string, string | undefined>) => {
    const result = await m.inventory(input);
    return {
      ...result,
      unit: input.view === 'holdings' ? 'holding row' : 'item',
      holdingRows: result.rows.length,
      rows: result.rows.map(
        (row: import('@/features/inventory/contracts-ui').InventoryResult) => ({
          row,
          holdings: [row],
          scopedStorage: String(row.quantity ?? 0),
          scopedSite: '0',
          holdingCount: row.location || row.site ? 1 : 0,
        }),
      ),
    };
  },
}));
vi.mock('@/features/inventory/components/view-controls', () => ({
  InventoryViewControls: m.viewControls,
}));
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

it.each([
  {
    input: scopedOrigin.replace(
      'q=Office&selected=ITO',
      'selected=ITO&q=Office',
    ),
    expected: scopedOrigin,
  },
  { input: ['/locations', scopedOrigin], expected: undefined },
  { input: '//outside.example/locations', expected: undefined },
  { input: '/locations?q=%GG', expected: undefined },
  { input: '/locations?q=Office#inventory-row-1', expected: undefined },
])(
  'only passes a validated directory parent to display navigation ($input)',
  async ({ input, expected }) => {
    m.viewControls.mockClear();
    m.inventory.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
      error: 'The item view is unavailable.',
    });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://inventory.supabase.co');
    try {
      render(
        await Page({
          params: Promise.resolve({ code: 'ITO' }),
          searchParams: Promise.resolve({ returnTo: input }),
        }),
      );
      expect(m.viewControls.mock.lastCall?.[0].directoryReturnTo).toBe(
        expected,
      );
      expect(m.viewControls.mock.lastCall?.[0].params).not.toHaveProperty(
        'returnTo',
      );
      const href = new URL(
        screen
          .getByRole('link', { name: 'Use Holdings view' })
          .getAttribute('href')!,
        'https://inventory.invalid',
      );
      expect(href.searchParams.get('view')).toBe('holdings');
      expect(href.searchParams.get('returnTo')).toBe(expected ?? null);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

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
  const page = await Page({
    params: Promise.resolve({ code: 'ITO' }),
    searchParams: Promise.resolve({
      returnTo: scopedOrigin,
      status: 'all',
      q: 'Cable',
      page: '2',
    }),
  });
  render(page);
  // The child card and all 25 descendant holdings share an accessible
  // location name. Only the child card retains the browser return scope.
  const childName = 'IT Office / General Storage / Unsorted (ITO-GENERAL)';
  const recordHref = new URL(
    screen
      .getByRole('link', { name: 'Descendant asset 1' })
      .getAttribute('href')!,
    'https://inventory.invalid',
  );
  const inventoryReturn = new URL(
    recordHref.searchParams.get('returnTo')!,
    'https://inventory.invalid',
  );
  expect(inventoryReturn.pathname).toBe('/locations/ITO');
  expect(inventoryReturn.searchParams.get('view')).toBe('items');
  expect(inventoryReturn.searchParams.get('density')).toBe('comfortable');
  expect(inventoryReturn.searchParams.get('q')).toBe('Cable');
  expect(inventoryReturn.hash).toBe('#inventory-row-1');
  expect(inventoryReturn.searchParams.get('returnTo')).toBe(scopedOrigin);
  const { recordDetailReturnPath } =
    await import('@/features/inventory/detail-return');
  expect(page.props.children.props.pairingHref).toBe(
    recordDetailReturnPath(inventoryReturn.pathname + inventoryReturn.search),
  );
  // Item groups retain their holdings while collapsed, but those links are not
  // accessible until staff open the corresponding storage and sites summary.
  const summaries = screen.getAllByText(
    'Storage and sites within these filters (1)',
    { selector: 'summary' },
  );
  expect(summaries).toHaveLength(25);
  expect(screen.getAllByRole('link', { name: childName })).toHaveLength(1);
  expect(
    screen.getAllByRole('link', { name: childName, hidden: true }),
  ).toHaveLength(26);
  for (const summary of summaries) {
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
  }
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
    screen
      .getByRole('link', { name: 'Matching holdings CSV' })
      .getAttribute('href')!,
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
  expect(
    screen.getAllByRole('link', { name: 'Show ITO in Spaces' }),
  ).toHaveLength(1);
  expect(
    screen.getByRole('region', { name: 'Storage preview' }),
  ).toBeInTheDocument();
  const actions = screen.getByRole('navigation', { name: 'Location actions' });
  expect(within(actions).getAllByRole('link')).toHaveLength(4);
  expect(
    within(actions).getByRole('link', { name: 'Print label' }),
  ).toHaveAttribute('href', '/labels?location=ITO');
  expect(
    within(actions).getByRole('link', { name: 'History' }),
  ).toHaveAttribute('href', '/history?location=ITO');
  expect(
    screen.getByRole('link', { name: 'Matching holdings CSV' }),
  ).toHaveAttribute(
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
it.each(['items', 'holdings'] as const)(
  'admits an implicit location route using its actual rendered %s return without invented page/location query state',
  async (view) => {
    const id = '00000000-0000-4000-8000-000000000009';
    m.inventory.mockResolvedValue({
      rows: [
        {
          kind: 'quantity',
          id,
          name: 'Scoped cable',
          categoryName: 'Cables',
          status: 'active',
          location: { ...location, id, can_hold_inventory: true },
          quantity: 2,
          assetTag: null,
          serialNumber: null,
          recordedTotal: null,
          reorderThreshold: null,
          stockState: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const params =
      view === 'items' ? { q: 'Cable' } : { q: 'Cable', view: 'holdings' };
    const rendered = render(
      await Page({
        params: Promise.resolve({ code: 'ITO' }),
        searchParams: Promise.resolve(params),
      }),
    );
    const href = new URL(
      screen.getByRole('link', { name: 'Scoped cable' }).getAttribute('href')!,
      'https://inventory.invalid',
    );
    const returned = href.searchParams.get('returnTo')!;
    const url = new URL(returned, 'https://inventory.invalid');
    expect(url.searchParams.has('location')).toBe(false);
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.get('view')).toBe(view);
    expect(url.searchParams.get('density')).toBe('comfortable');
    const { groupedTitleTarget } =
      await import('@/components/experience/route-motion-state');
    const { routeKey } = await import('@/components/experience/route-key');
    expect(
      groupedTitleTarget(
        { kind: 'quantity', id },
        {
          kind: 'location-inventory',
          locationCode: 'ITO',
          occurrence:
            view === 'items'
              ? { kind: 'aggregate' }
              : { kind: 'holding', holding: { domain: 'storage', id } },
        },
        returned,
        routeKey('/locations/ITO', params),
      ),
    ).not.toBeNull();
    rendered.unmount();
  },
);

it('starts the column catalog while location inventory is pending and awaits both reads', async () => {
  const result = { rows: [], total: 0, page: 1, pageSize: 25 };
  let releaseInventory!: (value: typeof result) => void;
  let releaseColumns!: (value: { fields: []; truncated: false }) => void;
  m.inventory.mockReturnValueOnce(
    new Promise<typeof result>((resolve) => {
      releaseInventory = resolve;
    }),
  );
  m.columns.mockClear();
  m.columns.mockReturnValueOnce(
    new Promise<{ fields: []; truncated: false }>((resolve) => {
      releaseColumns = resolve;
    }),
  );
  let settled = false;
  const page = Page({
    params: Promise.resolve({ code: 'ITO' }),
    searchParams: Promise.resolve({ columnSearch: 'Enabled' }),
  }).then((value) => {
    settled = true;
    return value;
  });
  await vi.waitFor(() => {
    expect(m.columns).toHaveBeenCalledExactlyOnceWith({
      columnSearch: 'Enabled',
    });
    expect(releaseInventory).toBeTypeOf('function');
  });
  releaseInventory(result);
  await Promise.resolve();
  expect(settled).toBe(false);
  releaseColumns({ fields: [], truncated: false });
  await page;
});

it('propagates the original column-catalog error on location inventory', async () => {
  const original = new Error('column catalog unavailable');
  m.inventory.mockResolvedValueOnce({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  m.columns.mockRejectedValueOnce(original);
  await expect(
    Page({
      params: Promise.resolve({ code: 'ITO' }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toBe(original);
});
