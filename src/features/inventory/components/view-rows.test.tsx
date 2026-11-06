import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InventoryViewRows as ActualRows } from './view-rows';
import visualStyles from './inventory-visual.module.css';
import { PeekProvider } from '@/features/peek/peek-provider';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
function InventoryViewRows(props: React.ComponentProps<typeof ActualRows>) {
  return (
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'view-rows-test',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      <ActualRows {...props} />
    </PrivacyReadinessContext>
  );
}
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));
vi.mock('@/features/room/show-in-room', () => ({
  ShowInRoom: ({ location }: { location: { code: string } }) => (
    <a href={`/room?location=${location.code}`}>Show in room</a>
  ),
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const location = (n: number) => ({
  id: id(n),
  code: `ITC-${n}`,
  name: `Shelf ${n}`,
  breadcrumb: `IT Closet / Shelf ${n}`,
  active: true,
  can_hold_inventory: true,
  parentId: null,
});
const row = {
  kind: 'quantity' as const,
  id: id(1),
  name: 'Cable',
  categoryName: 'Cables',
  status: 'active',
  location: location(2),
  quantity: 10,
  assetTag: null,
  serialNumber: null,
  recordedTotal: null,
  reorderThreshold: null,
  stockState: null,
  availableQuantity: '9007199254740993',
  assignedQuantity: '3',
  ownedQuantity: '9007199254740996',
};
it('keeps the filtered location-browser parent in the grouped record destination', () => {
  const parent =
    '/locations?q=Closet&selected=ITC-2&level=ITC&expanded=ITC#location-row-mobile-level-' +
    id(2);
  const scope =
    '/locations/ITC-2?' +
    new URLSearchParams({
      q: 'Cable',
      view: 'items',
      density: 'comfortable',
      returnTo: parent,
    });
  const view = render(
    <InventoryViewRows
      result={{
        rows: [
          {
            row,
            holdings: [row],
            scopedStorage: '10',
            scopedSite: '0',
            holdingCount: 1,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        unit: 'item',
        holdingRows: 1,
      }}
      preferences={{ view: 'items', density: 'comfortable', columns: [] }}
      returnTo={scope}
      currentLocationCode="ITC-2"
    />,
  );
  const target = new URL(
    screen.getByRole('link', { name: 'Cable' }).getAttribute('href')!,
    'https://inventory.invalid',
  );
  const returned = new URL(
    target.searchParams.get('returnTo')!,
    'https://inventory.invalid',
  );
  expect(returned.pathname).toBe('/locations/ITC-2');
  expect(returned.searchParams.get('returnTo')).toBe(parent);
  expect(returned.hash).toBe('#inventory-row-1');
  view.unmount();
});
it('renders one item identity with complete scoped holdings, separate totals and each room link', () => {
  const group = {
    row,
    holdings: [row, { ...row, location: location(3), quantity: 25 }],
    scopedStorage: '35',
    scopedSite: '0',
    holdingCount: 2,
    preview: {
      answers: [
        {
          fieldId: id(4),
          label: 'Enabled',
          type: 'boolean',
          displayValue: 'No',
          present: true,
          absence: null,
          legacy: true,
          truncated: false,
        },
        {
          fieldId: id(5),
          label: 'Count',
          type: 'integer',
          displayValue: '0',
          present: true,
          absence: null,
          legacy: false,
          truncated: false,
        },
      ],
      truncated: false,
    },
  };
  render(
    <InventoryViewRows
      result={{
        rows: [group],
        total: 1,
        page: 1,
        pageSize: 25,
        holdingRows: 2,
        unit: 'item',
      }}
      preferences={{
        view: 'items',
        density: 'compact',
        columns: [id(4), id(5)],
      }}
      returnTo="/inventory?view=items&density=compact"
    />,
  );
  expect(screen.getAllByRole('link', { name: 'Cable' })).toHaveLength(1);
  const scoped = screen.getByText('Within these filters:').parentElement!;
  expect(scoped).toHaveTextContent('available in storage');
  expect(scoped.querySelector('[data-count-final]')).toHaveTextContent('35');
  const overall = screen.getByText(/Overall item totals:/);
  expect(overall).toBeVisible();
  expect(
    [...overall.querySelectorAll('[data-count-final]')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['9007199254740993', '3', '9007199254740996']);
  const expansion = screen
    .getByText('Storage and sites within these filters (2)')
    .closest('details')!;
  fireEvent.click(
    screen.getByText('Storage and sites within these filters (2)'),
  );
  expect(
    within(expansion).getAllByRole('link', { name: 'Show in room' }),
  ).toHaveLength(2);
  expect(screen.getByText('No (recorded revision)')).toBeVisible();
  expect(
    screen.getByText('Count', { selector: 'p' }).parentElement,
  ).toHaveTextContent('0');
  expect(
    screen.getByRole('link', { name: 'Cable' }).getAttribute('href'),
  ).toContain(encodeURIComponent('#inventory-row-1'));
});

it('shows distinct absence messages and historical label provenance without treating them as stored answers', () => {
  const answers = [
    {
      fieldId: id(4),
      label: 'Enabled',
      type: 'boolean',
      displayValue: 'Unanswered',
      present: false,
      absence: 'unanswered' as const,
      legacy: false,
      truncated: false,
    },
    {
      fieldId: id(5),
      label: 'Asset only',
      type: 'boolean',
      displayValue: 'Not applicable to this tracking type',
      present: false,
      absence: 'not_applicable' as const,
      legacy: false,
      truncated: false,
    },
    {
      fieldId: id(6),
      label: 'Retired field',
      type: 'boolean',
      displayValue: 'Historical field - no current definition',
      present: false,
      absence: 'historical_unavailable' as const,
      legacy: true,
      truncated: false,
    },
  ];
  render(
    <InventoryViewRows
      result={{
        rows: [
          {
            row,
            holdings: [row],
            scopedStorage: '10',
            scopedSite: '0',
            holdingCount: 1,
            preview: { answers, truncated: false },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        holdingRows: 1,
        unit: 'item',
      }}
      preferences={{
        view: 'items',
        density: 'comfortable',
        columns: answers.map((answer) => answer.fieldId),
      }}
      returnTo="/inventory"
    />,
  );
  expect(screen.getByText('Unanswered')).toBeVisible();
  expect(
    screen.getByText('Not applicable to this tracking type'),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Historical field - no current definition (historical published label)',
    ),
  ).toBeVisible();
  expect(screen.queryByText(/recorded revision/)).toBeNull();
  expect(document.body.textContent).not.toContain(id(6));
});

it('opens a current authenticated item peek through the grouped record link without expanding holdings or changing its destination', async () => {
  const actor = id(8),
    backend = 'https://inventory-views.test';
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([new DOMRect(10, 20, 200, 30)] as unknown as DOMRectList);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      actor,
      backend,
      payload: {
        target: { kind: 'quantity', id: row.id },
        name: 'Current cable record',
        status: 'active',
        assetTag: null,
        stock: {
          available: '9007199254740993',
          assigned: '3',
          recorded: '9007199254740996',
        },
        locations: [],
        moreLocations: false,
        siteName: null,
        photo: null,
      },
    }),
  );
  const view = render(
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'grouped-peek',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      <PeekProvider actor={actor} backend={backend}>
        <ActualRows
          result={{
            rows: [
              {
                row,
                holdings: [row],
                scopedStorage: '10',
                scopedSite: '0',
                holdingCount: 1,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 25,
            holdingRows: 1,
            unit: 'item',
          }}
          preferences={{ view: 'items', density: 'comfortable', columns: [] }}
          returnTo="/inventory?view=items"
        />
      </PeekProvider>
    </PrivacyReadinessContext>,
  );
  try {
    const link = screen.getByRole('link', { name: 'Cable' }),
      target = link.getAttribute('href');
    expect(fetcher).not.toHaveBeenCalled();
    act(() => link.focus());
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Current cable record',
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      '/api/peek?kind=quantity&id=' + row.id,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(link).toHaveAttribute('href', target);
    expect(
      screen
        .getByText('Storage and sites within these filters (1)')
        .closest('details'),
    ).not.toHaveAttribute('open');
    fireEvent.keyDown(link, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(link).toHaveFocus();
  } finally {
    view.unmount();
    geometry.mockRestore();
    fetcher.mockRestore();
  }
});
it.each([
  { available: '3', threshold: 10, expected: '7 below threshold' },
  { available: '10', threshold: 10, expected: 'At threshold' },
  { available: '0', threshold: 0, expected: 'At threshold' },
  { available: null, threshold: 10, expected: null },
  { available: '3', threshold: null, expected: null },
  { available: '9007199254740993', threshold: 10, expected: 'Above threshold' },
])(
  'uses only item-wide storage availability for A308: %j',
  ({ available, threshold, expected }) => {
    const item = {
      ...row,
      quantity: 999,
      recordedTotal: 999,
      availableQuantity: available,
      reorderThreshold: threshold,
      stockState: 'needs_restocking',
    };
    const view = render(
      <InventoryViewRows
        result={{
          rows: [
            {
              row: item,
              holdings: [item],
              scopedStorage: '999',
              scopedSite: '999',
              holdingCount: 1,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          unit: 'item',
          holdingRows: 1,
        }}
        preferences={{ view: 'items', density: 'comfortable', columns: [] }}
        returnTo="/inventory?view=items&density=comfortable"
      />,
    );
    const warning = screen.getByText(/Needs restocking/);
    if (expected) expect(warning).toHaveTextContent(expected);
    else
      expect(warning).not.toHaveTextContent(
        /below threshold|At threshold|Above threshold/,
      );
    view.unmount();
  },
);
it('omits the current location breadcrumb while preserving its room action and descendant breadcrumbs', () => {
  const view = render(
    <InventoryViewRows
      result={{
        rows: [
          {
            row,
            holdings: [row, { ...row, location: location(3) }],
            scopedStorage: '20',
            scopedSite: '0',
            holdingCount: 2,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        unit: 'item',
        holdingRows: 2,
      }}
      preferences={{ view: 'items', density: 'comfortable', columns: [] }}
      currentLocationId={location(2).id}
      currentLocationCode={location(2).code}
      returnTo={
        '/locations/' + location(2).code + '?view=items&density=comfortable'
      }
    />,
  );
  fireEvent.click(
    screen.getByText('Storage and sites within these filters (2)'),
  );
  expect(screen.getByText('At this location')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: /IT Closet \/ Shelf 2/ }),
  ).toBeNull();
  expect(
    screen.getByRole('link', { name: /IT Closet \/ Shelf 3/ }),
  ).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Show in room' })).toHaveLength(2);
  view.unmount();
});

it.each(['comfortable', 'compact'] as const)(
  'keeps site and shortened-preview navigation touch-sized in %s density',
  (density) => {
    const siteHolding = {
      ...row,
      location: null,
      site: { id: id(9), code: 'OFFICE', name: 'Office', active: true },
    };
    const view = render(
      <InventoryViewRows
        result={{
          rows: [
            {
              row,
              holdings: [siteHolding],
              scopedStorage: '0',
              scopedSite: '10',
              holdingCount: 1,
              preview: {
                answers: [
                  {
                    fieldId: id(4),
                    label: 'Notes',
                    type: 'text',
                    displayValue: 'Short preview',
                    present: true,
                    absence: null,
                    legacy: false,
                    truncated: true,
                  },
                ],
                truncated: true,
              },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          unit: 'item',
          holdingRows: 1,
        }}
        preferences={{ view: 'items', density, columns: [id(4)] }}
        returnTo="/inventory?view=items"
      />,
    );
    const preview = screen.getByRole('link', {
      name: 'Preview shortened · full details',
    });
    expect(preview).toHaveClass(visualStyles.textTarget);
    expect(preview).toHaveAttribute(
      'href',
      expect.stringContaining('/inventory/quantity/' + row.id),
    );
    fireEvent.click(
      screen.getByText('Storage and sites within these filters (1)'),
    );
    const site = screen.getByRole('link', {
      name: 'Assigned to Office (OFFICE) · no room model',
    });
    expect(site).toHaveClass(visualStyles.textTarget);
    expect(site).toHaveAttribute('href', '/sites/OFFICE');
    expect(site.closest('details')).toHaveAttribute('open');
    view.unmount();
  },
);
