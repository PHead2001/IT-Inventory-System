import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode, ViewTransitionProps } from 'react';
import AssetPage from './inventory/assets/[id]/page';
import QuantityPage from './inventory/quantity/[id]/page';
import LocationPage from './locations/[code]/page';

const state = vi.hoisted(() => ({
  path: '/inventory/assets/asset',
  pending: true,
  site: false,
  locationPair: false,
  description: 'A short description with all its text visible.',
}));
vi.mock('server-only', () => ({}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  ViewTransition: ({
    children,
    name,
    share,
    enter,
    exit,
  }: ViewTransitionProps) => (
    <div
      data-active-capture={name}
      data-share={share}
      data-enter={enter}
      data-exit={exit}
    >
      {children}
    </div>
  ),
}));
vi.mock('@/components/experience/route-motion', () => ({
  useRouteMotion: () => ({
    enabled: true,
    current: () => true,
    validNow: () => true,
    intent: state.path.startsWith('/locations/')
      ? state.locationPair
        ? {
            name: 'accepted-title',
            kind: 'location',
            id: 'drawer',
            code: 'ITC-D01',
            detailPath: state.path,
            listHref: '/locations',
            source: {
              kind: 'location-row',
              locationId: 'drawer',
              occurrence: 'desktop-tree',
            },
          }
        : null
      : {
          name: 'accepted-title',
          kind: state.path.includes('/assets/') ? 'asset' : 'quantity',
          id: state.path.includes('/assets/') ? 'asset' : 'item',
          detailPath: state.path,
          listHref: '/inventory',
          holding: { domain: 'storage', id: 'drawer' },
        },
    titleArrival:
      state.path.startsWith('/locations/') && !state.locationPair
        ? null
        : {
            sourceKey: state.locationPair ? '/locations' : '/inventory',
            destinationKey: state.path,
            epoch: 1,
          },
    arrival:
      state.path.startsWith('/locations/') && !state.locationPair
        ? {
            name: 'accepted-primary',
            presentation: 'primary',
            sourceKey: '/locations',
            destinationKey: state.path,
            epoch: 1,
          }
        : null,
    arm: () => {},
    armBack: () => {},
    retireTitle: () => {},
    finishTitleAfterSnapshot: () => true,
    finishPairedContentAfterSnapshot: () => true,
    finishPrimaryAfterSnapshot: () => true,
    cancelIfInvalid: () => {},
  }),
  useInvalidateRouteMotion: () => () => {},
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('Unexpected missing fixture');
  },
  redirect: () => {
    throw new Error('Unexpected fixture redirect');
  },
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading(): ReactNode }) => () =>
    state.pending ? (
      options.loading()
    ) : (
      <canvas data-testid="actual-canvas-sentinel" />
    ),
}));
vi.mock('@/components/auth/privacy-content', () => ({
  ProtectedPrivacyContent: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/auth/private-document-title', () => ({
  PrivateDocumentTitle: () => null,
}));
vi.mock('@/features/metadata/metadata-form', () => ({
  MetadataForm: () => <form aria-label="Edit details" />,
}));
vi.mock('@/features/metadata/custom-metadata-list', () => ({
  CustomMetadataList: () => <p>Recorded metadata</p>,
}));
vi.mock('@/features/files/files-panel', () => ({
  FilesPanel: () => <p>Recorded files</p>,
}));
vi.mock('@/features/files/cards.server', () => ({
  getInventoryFileCards: async () => ({
    status: 'ready',
    envelope: { revision: '1', files: [] },
  }),
}));
vi.mock('@/features/inventory/actions', () => ({
  submitInventory: vi.fn(),
  findDuplicateSerials: vi.fn(),
}));
vi.mock('@/features/inventory/asset-tag.actions', () => ({
  checkAssetTag: vi.fn(),
}));
vi.mock('@/features/custody/actions', () => ({
  submitCustody: vi.fn(),
  loadCustodyReceipt: vi.fn(),
}));

const location = {
  id: 'drawer',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'IT Closet / Drawer 1',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
const item = {
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
};
const asset = {
  ...item,
  id: 'asset',
  name: 'Laptop',
  status: 'active',
  assetTag: 'LAP-01',
  serialNumber: null,
};
const site = {
  id: 'site',
  code: 'SITE-1',
  name: 'Example site',
  notes: null,
  active: true,
  version: '1',
};
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: {
      user_id: 'staff',
      role: 'staff',
      can_manage_configuration: false,
    },
  }),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getAssetDetail: async () => ({
    asset: { ...asset, description: state.description },
    location: state.site ? null : location,
    site: state.site ? site : null,
    history: [],
    duplicateSerialMatches: [],
  }),
  getQuantityDetail: async () => ({
    item: { ...item, description: state.description },
    balances: [{ location, quantity: 2 }],
    history: [],
    stockSummary: {
      availableQuantity: '2',
      assignedQuantity: '0',
      ownedQuantity: '2',
      reorderThreshold: null,
      stockState: 'disabled',
    },
  }),
  getLocation: async () => location,
  getInventory: async () => ({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    quantityTotal: '0',
    assetTotal: 0,
  }),
  getCategories: async () => [],
  getLocations: async () => [
    location,
    {
      ...location,
      id: 'second',
      code: 'ITC-D02',
      name: 'Drawer 2',
      breadcrumb: 'IT Closet / Drawer 2',
    },
  ],
  getQuantityArchiveReview: async () => null,
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSites: async () => [site],
  getAssetReturnSuggestion: async () => undefined,
  getEntitySiteHoldings: async () => [],
  getEntityAssignments: async () => [],
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: async () => ({}),
}));

beforeEach(() => {
  state.pending = true;
  state.site = false;
  state.locationPair = false;
  state.description = 'A short description with all its text visible.';
  sessionStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.textContent?.startsWith('Long description') ? 1920 : 24;
    },
  );
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const styles = computed(element);
    return element.tagName === 'P'
      ? new Proxy(styles, {
          get: (target, key) =>
            key === 'lineHeight'
              ? '24px'
              : key === 'fontSize'
                ? '16px'
                : Reflect.get(target, key, target),
        })
      : styles;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
function expectOutsideCapture(element: Element) {
  expect(element.closest('[data-active-capture]')).toBeNull();
}
async function page(kind: 'asset' | 'quantity' | 'location') {
  state.path =
    kind === 'location'
      ? '/locations/ITC-D01'
      : `/inventory/${kind === 'asset' ? 'assets/asset' : 'quantity/item'}`;
  if (kind === 'asset')
    return AssetPage({ params: Promise.resolve({ id: 'asset' }) });
  if (kind === 'quantity')
    return QuantityPage({ params: Promise.resolve({ id: 'item' }) });
  return LocationPage({
    params: Promise.resolve({ code: location.code }),
    searchParams: Promise.resolve({}),
  });
}

it.each(['asset', 'quantity'] as const)(
  '%s places tasks after the complete hero and preserves captured details before maps',
  async (kind) => {
    render(await page(kind));
    const header = document.querySelector(
      '[data-active-capture="accepted-title-content-header"]',
    )!;
    const body = document.querySelector(
      '[data-active-capture="accepted-title-content"]',
    )!;
    const supporting = document.querySelector(
      '[data-active-capture="accepted-title-content-record-supporting-content"]',
    )!;
    const details = screen.getByRole('heading', {
      name: kind === 'asset' ? 'Asset details' : 'Item details',
    });
    const tasks = screen.getByRole('region', { name: 'Record tasks' });
    expect(header.nextElementSibling).toBe(tasks);
    expect(tasks.nextElementSibling).toBe(body);
    expect(body).toContainElement(details);
    expect(body).toHaveTextContent(state.description);
    expect(body).toHaveTextContent('Manufacturer');
    expect(body).toHaveTextContent('Model');
    expect(
      screen.queryByRole('button', { name: 'Show full description' }),
    ).toBeNull();
    const preview = screen.getByRole('region', { name: 'Storage preview' });
    expect(
      tasks.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      body.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      preview.compareDocumentPosition(supporting) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(supporting).toContainElement(screen.getByText('Recorded metadata'));
    expect(supporting).toContainElement(screen.getByText('Recorded files'));
    expect(supporting).toContainElement(
      screen.getByRole('heading', { name: 'Recent history' }),
    );
    expectOutsideCapture(preview);
  },
);

it.each(['asset', 'quantity'] as const)(
  '%s expands the complete long description in place without replacing task or map state',
  async (kind) => {
    state.description =
      'Long description line.\n'.repeat(80) + 'Last recorded sentence.';
    const view = render(await page(kind));
    const body = document.querySelector(
      '[data-active-capture="accepted-title-content"]',
    )!;
    const toggle = screen.getByRole('button', {
      name: 'Show full description',
    });
    const description = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    )!;
    expect(description.textContent).toBe(state.description);
    const tasks = screen.getByRole('region', { name: 'Record tasks' });
    const preview = screen.getByRole('region', { name: 'Storage preview' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(description.textContent).toBe(state.description);
    expect(body).toContainElement(description);
    fireEvent.click(
      screen.getByRole('button', { name: 'Show less description' }),
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(description.textContent).toBe(state.description);
    state.pending = false;
    view.rerender(await page(kind));
    expect(screen.getByRole('region', { name: 'Record tasks' })).toBe(tasks);
    expect(screen.getByRole('region', { name: 'Storage preview' })).toBe(
      preview,
    );
    for (const canvas of screen.getAllByTestId('actual-canvas-sentinel'))
      expectOutsideCapture(canvas);
  },
);

it.each(['asset', 'quantity', 'location'] as const)(
  '%s keeps cold and warm preview slots outside every active capture while conventional regions participate',
  async (kind) => {
    const content = await page(kind);
    const view = render(content);
    expect(document.querySelectorAll('[data-route-ready]')).toHaveLength(1);
    expect(
      document.querySelector('.experience-paired-inventory-content'),
    ).toBeNull();
    const preview = screen.getByRole('region', { name: 'Storage preview' });
    expectOutsideCapture(preview);
    expectOutsideCapture(
      preview.querySelector('[data-loading-shape="compact-room"]')!,
    );
    const base =
      kind === 'location' ? 'accepted-primary' : 'accepted-title-content';
    expect(
      document.querySelector(`[data-active-capture="${base}-header"]`),
    ).not.toBeNull();
    expect(
      document.querySelector(`[data-active-capture="${base}"]`),
    ).not.toBeNull();
    state.pending = false;
    view.rerender(await page(kind));
    for (const canvas of screen.getAllByTestId('actual-canvas-sentinel'))
      expectOutsideCapture(canvas);
    expect(
      screen
        .getByRole('heading', { name: 'Storage preview' })
        .closest('[data-active-capture]'),
    ).not.toBeNull();
  },
);

it.each(['asset', 'quantity', 'custody'] as const)(
  '%s task map stays outside launcher/form captures during cold and warm loading',
  async (kind) => {
    state.site = kind === 'custody';
    const surface = kind === 'quantity' ? 'quantity' : 'asset';
    const content = await page(surface);
    const view = render(content);
    fireEvent.click(
      screen.getByRole('button', {
        name:
          kind === 'custody'
            ? 'Return to storage'
            : kind === 'asset'
              ? 'Move asset'
              : 'Move stock',
      }),
    );
    expect(
      screen
        .getByRole('region', { name: 'Record tasks' })
        .closest('[data-active-capture]'),
    ).toBeNull();
    const form = await screen.findByRole('form', {
      name:
        kind === 'custody'
          ? 'Return to storage'
          : kind === 'asset'
            ? 'Move asset'
            : 'Move stock',
    });
    expectOutsideCapture(form);
    fireEvent.click(screen.getByRole('button', { name: 'Pick on map' }));
    expectOutsideCapture(
      screen
        .getByText('Loading map… Your form draft remains available.')
        .closest('[aria-busy]')!,
    );
    expect(
      document.querySelector(
        '[data-active-capture="accepted-title-content-picker-destination"]',
      ),
    ).not.toBeNull();
    state.pending = false;
    view.rerender(await page(surface));
    for (const canvas of screen.getAllByTestId('actual-canvas-sentinel'))
      expectOutsideCapture(canvas);
    expect(
      screen.getByRole('form', { name: form.getAttribute('aria-label')! }),
    ).toBe(form);
  },
);

it('location title pairing captures only explicit header/body regions under its one canonical owner', async () => {
  state.locationPair = true;
  render(await page('location'));
  expect(document.querySelectorAll('[data-route-ready]')).toHaveLength(1);
  expect(
    document.querySelector(
      '[data-active-capture="accepted-title-content-header"]',
    ),
  ).not.toBeNull();
  expect(
    document.querySelector('[data-active-capture="accepted-title-content"]'),
  ).not.toBeNull();
  expect(
    screen
      .getByRole('heading', { name: 'Drawer 1' })
      .closest('[data-active-capture="accepted-title"]'),
  ).not.toBeNull();
  const preview = screen.getByRole('region', { name: 'Storage preview' });
  expectOutsideCapture(preview);
  expectOutsideCapture(
    preview.querySelector('[data-loading-shape="compact-room"]')!,
  );
});
