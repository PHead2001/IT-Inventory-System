vi.mock('server-only', () => ({}));
// Protected page readiness receives the same mocked request actor as its reads.
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({
    member: {
      user_id: 'route-test-actor',
      role: 'staff',
      can_manage_configuration: true,
    },
  }),
}));
import { render as actualRender, screen } from '@testing-library/react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
function render(ui: React.ReactNode) {
  return actualRender(ui, {
    wrapper: ({ children }) => (
      <PrivacyReadinessContext
        value={{
          ready: true,
          visible: true,
          generation: 'history-page-test',
          verifiedEpoch: assignmentEpoch(),
          revocationRevision: readPrivacyRevocationRevision(),
        }}
      >
        {children}
      </PrivacyReadinessContext>
    ),
  });
}
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  history: vi.fn(),
  identity: vi.fn(),
  redirect: vi.fn(),
  custom: vi.fn(),
  actors: vi.fn(),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getHistoryRecord: m.identity,
  getLocations: async () => [],
}));
vi.mock('@/features/inventory/history-queries.server', () => ({
  getFilteredHistory: m.history,
  getHistoryActors: m.actors,
}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({ url: 'https://backend.test' }),
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getEventCustomPage: m.custom,
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  redirect: m.redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
import Page from './page';
import styles from '@/features/inventory/components/inventory-visual.module.css';
import { OperationalTimeProvider } from '@/components/operational-time';
import * as operationalTime from '@/lib/operational-time';
import { routeKey } from '@/components/experience/route-key';
import { historyTitleTarget } from '@/components/experience/route-motion-state';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  m.actors.mockResolvedValue({ rows: [], total: 0 });
  m.history.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
  m.identity.mockResolvedValue({ id, name: 'Adapters', kind: 'quantity' });
});
it.each([
  { eventType: 'all' },
  { entityId: id, type: 'quantity', eventType: 'all', page: '2' },
  { entityId: id, type: 'asset', eventType: 'all', page: '2' },
])(
  'binds canonical event-return content separately from exact raw readiness for %j',
  async (raw) => {
    const eventId = '00000000-0000-4000-8000-000000000002';
    m.history.mockResolvedValue({
      rows: [
        {
          id: eventId,
          kind: 'quantity',
          entityId: id,
          entityName: 'Canonical event item',
          eventType: 'created',
          at: '2026-10-13T10:00:00Z',
          actorName: 'Staff',
          reason: null,
          assignment: null,
          lines: [],
          fromLocation: null,
          toLocation: null,
          metadataChanges: [],
          customMetadataPresent: false,
          customMetadataChanged: false,
        },
      ],
      total: 30,
      page: raw.page === '2' ? 2 : 1,
      pageSize: 25,
    });
    const page = await Page({ searchParams: Promise.resolve(raw) });
    render(page);
    const detail = new URL(
      screen
        .getByRole('link', { name: 'Canonical event item' })
        .getAttribute('href')!,
      'https://inventory.invalid',
    );
    const returned = detail.searchParams.get('returnTo')!;
    const origin = new URL(returned, 'https://inventory.invalid');
    const primary = page.props.children;
    const content = new URL(
      primary.props.pairingHref,
      'https://inventory.invalid',
    );
    expect(routeKey(content.pathname, content.searchParams)).toBe(
      routeKey(origin.pathname, origin.searchParams),
    );
    expect(content.hash).toBe('');
    expect(origin.hash).toBe('#history-event-quantity-' + eventId);
    expect(origin.searchParams.has('eventType')).toBe(false);
    const rawKey = routeKey('/history', raw);
    expect(primary.props.routeKey).toBe(rawKey);
    expect(page.props.routeKey).toBe(rawKey);
    const target = historyTitleTarget(
      { kind: 'quantity', id },
      { kind: 'quantity', id: eventId },
      returned,
      rawKey,
    );
    // A reconciled record type changes canonical content, never raw authority.
    if (raw.type === 'asset') expect(target).toBeNull();
    else
      expect(target?.listHref).toBe(
        routeKey(content.pathname, content.searchParams),
      );
    const mismatch = new URLSearchParams(rawKey.split('?')[1]);
    mismatch.set('page', '3');
    expect(
      historyTitleTarget(
        { kind: 'quantity', id },
        { kind: 'quantity', id: eventId },
        returned,
        routeKey('/history', mismatch),
      ),
    ).toBeNull();
  },
);
it('passes canonical main history filter/page scope to its event entity links', async () => {
  const eventId = '00000000-0000-4000-8000-000000000002';
  m.history.mockResolvedValue({
    rows: [
      {
        id: eventId,
        kind: 'quantity',
        entityId: id,
        entityName: 'Scoped adapters',
        eventType: 'created',
        at: '2026-10-13T10:00:00Z',
        actorName: 'Staff',
        reason: null,
        assignment: null,
        lines: [],
        fromLocation: null,
        toLocation: null,
        metadataChanges: [],
        customMetadataPresent: false,
        customMetadataChanged: false,
      },
    ],
    total: 30,
    page: 2,
    pageSize: 25,
  });
  render(
    await Page({
      searchParams: Promise.resolve({
        type: 'quantity',
        location: 'ITC',
        entityId: id,
        page: '2',
      }),
    }),
  );
  const url = new URL(
    screen.getByRole('link', { name: 'Scoped adapters' }).getAttribute('href')!,
    'https://inventory.invalid',
  );
  expect(url.searchParams.get('returnTo')).toBe(
    `/history?type=quantity&location=ITC&entityId=${id}&page=2#history-event-quantity-${eventId}`,
  );
});
it.each([
  ['datetime', '2026-10-03T05:23:06.123456Z'],
  ['date', '2024-02-29'],
  ['short_text', '2026-10-03T05:23:06.123456Z'],
])(
  'displays only typed %s snapshot instants while retaining raw recorded JSON',
  async (fieldType, value) => {
    const zone = vi
      .spyOn(operationalTime, 'browserDisplayTimeZone')
      .mockReturnValue({ timeZone: 'America/Los_Angeles', fallback: false });
    const snapshot = {
      field_id: id,
      label: 'Recorded field',
      legacy: false,
      present: true,
      field_type: fieldType,
      value,
      validated_revision_id: id,
      owner_category_id: id,
      option_paths: [],
      next_option_offset: null,
    };
    const before = structuredClone(snapshot);
    m.custom.mockResolvedValue(snapshot);
    try {
      const { container } = render(
        <OperationalTimeProvider>
          {await Page({
            searchParams: Promise.resolve({
              event: 'asset:' + id,
              side: 'after',
              field: id,
            }),
          })}
        </OperationalTimeProvider>,
      );
      expect(m.custom).toHaveBeenCalledWith({
        kind: 'asset',
        eventId: id,
        side: 'after',
        fieldId: id,
        optionOffset: 0,
      });
      expect(container.querySelector('pre')?.textContent).toBe(
        JSON.stringify(value),
      );
      expect(container.querySelectorAll('time')).toHaveLength(
        fieldType === 'datetime' ? 1 : 0,
      );
      if (fieldType === 'datetime') {
        expect(container.querySelector('time')).toHaveAttribute(
          'datetime',
          value,
        );
        expect(
          screen.getByText(/2 Oct 2026, 22:23:06 UTC-07:00/),
        ).toBeVisible();
      }
      expect(snapshot).toEqual(before);
    } finally {
      zone.mockRestore();
    }
  },
);
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

it.each([
  [false, 'No'],
  [true, 'Yes'],
  ['', 'Empty text'],
  [0, '0'],
])(
  'shows human snapshot answer %s with optional raw JSON',
  async (value, label) => {
    m.custom.mockResolvedValue({
      field_id: id,
      label: 'Answer',
      legacy: false,
      present: true,
      field_type: typeof value === 'boolean' ? 'boolean' : 'short_text',
      value,
      validated_revision_id: id,
      owner_category_id: id,
      option_paths: [],
      next_option_offset: null,
    });
    render(
      await Page({
        searchParams: Promise.resolve({ event: 'quantity:' + id }),
      }),
    );
    expect(screen.getByText(label, { selector: 'p' })).toBeVisible();
    expect(
      screen.getByText('Technical recorded value').closest('details'),
    ).not.toHaveAttribute('open');
  },
);
it.each([
  ['https://example.test/long?q=value', true],
  ['javascript:alert(1)', false],
])(
  'revalidates recorded link %s before exposing Open/Copy',
  async (value, safe) => {
    m.custom.mockResolvedValue({
      field_id: id,
      label: 'Recorded link',
      legacy: true,
      present: true,
      field_type: 'url',
      value,
      validated_revision_id: id,
      owner_category_id: id,
      option_paths: [],
      next_option_offset: null,
    });
    render(
      await Page({ searchParams: Promise.resolve({ event: 'asset:' + id }) }),
    );
    if (safe) {
      expect(screen.getByRole('link', { name: /Open https/ })).toHaveAttribute(
        'href',
        value,
      );
      expect(screen.getByRole('button', { name: /Copy https/ })).toBeVisible();
    } else {
      expect(
        screen.queryByRole('link', { name: /Open javascript/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/not a safe HTTP or HTTPS link/)).toBeVisible();
    }
  },
);

it('keeps active record and location filter links touch-sized without changing their destinations', async () => {
  render(
    await Page({
      searchParams: Promise.resolve({ entityId: id, location: 'ITC-BLACK' }),
    }),
  );
  const destinations = [
    ['Adapters', '/inventory/quantity/' + id],
    ['Clear record filter', '/history?type=quantity&location=ITC-BLACK'],
    ['Clear location filter', '/history?entityId=' + id + '&type=quantity'],
  ];
  for (const [name, href] of destinations) {
    const link = screen.getByRole('link', { name });
    expect(link).toHaveClass(styles.textTarget);
    expect(link).toHaveAttribute('href', href);
  }
});
it('uses wrapping touch targets for every custom snapshot navigation and option-page link', async () => {
  const nextField = '00000000-0000-4000-8000-000000000002';
  m.custom.mockResolvedValue({
    field_id: id,
    label: 'Recorded field',
    legacy: false,
    present: true,
    field_type: 'short_text',
    value: 'Recorded answer',
    validated_revision_id: id,
    owner_category_id: id,
    option_paths: [],
    option_offset: 16,
    next_option_offset: 32,
    next_field_id: nextField,
  });
  render(
    await Page({
      searchParams: Promise.resolve({
        event: 'quantity:' + id,
        field: id,
        side: 'after',
        optionOffset: '16',
      }),
    }),
  );
  const prefix = '/history?event=quantity:' + id;
  for (const [name, href] of [
    ['Back to history', '/history'],
    ['Before event', prefix + '&side=before&field=' + id],
    ['After event', prefix + '&side=after&field=' + id],
    ['Previous option paths', prefix + '&side=after&field=' + id],
    [
      'Next option paths',
      prefix + '&side=after&field=' + id + '&optionOffset=32',
    ],
    ['Next custom field', prefix + '&side=after&field=' + nextField],
  ]) {
    const link = screen.getByRole('link', { name });
    expect(link).toHaveClass(styles.textTarget);
    expect(link).toHaveAttribute('href', href);
  }
  expect(
    screen.getByRole('navigation', { name: 'Event snapshot side' }),
  ).toHaveClass('flex-wrap');
});
it.each([
  { from: 'invalid' },
  { actor: 'bad' },
  { type: 'quantity', eventType: 'retired' },
  { type: 'asset', eventType: 'received' },
  { from: '2026-10-02T00:00:00Z', until: '2026-10-01T00:00:00Z' },
])(
  'preserves the protected shell and local errors for invalid history scope %#',
  async (params) => {
    render(await Page({ searchParams: Promise.resolve(params) }));
    expect(
      screen.getByRole('heading', { name: 'Inventory history' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(m.history).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('link', { name: 'Export history CSV' }),
    ).toBeNull();
  },
);
it('retains all new filters in event record return paths', async () => {
  const query = {
    type: 'quantity',
    actor: id,
    eventType: 'movements',
    q: 'old code',
    from: '2026-11-01T06:59:59.123456Z',
    until: '2026-11-01T06:59:59.123457Z',
    zone: 'America/Chicago',
    page: '2',
  };
  m.history.mockResolvedValue({
    rows: [
      {
        id,
        kind: 'quantity',
        entityId: id,
        entityName: 'Complete scope',
        eventType: 'moved',
        at: query.from,
        actorName: 'Alex',
        reason: null,
        assignment: null,
        lines: [],
        fromLocation: null,
        toLocation: null,
        metadataChanges: [],
        customMetadataPresent: false,
        customMetadataChanged: false,
      },
    ],
    total: 30,
    page: 2,
    pageSize: 25,
  });
  render(await Page({ searchParams: Promise.resolve(query) }));
  const link = new URL(
    screen.getByRole('link', { name: 'Complete scope' }).getAttribute('href')!,
    'https://inventory.invalid',
  );
  const origin = new URL(
    link.searchParams.get('returnTo')!,
    'https://inventory.invalid',
  );
  for (const [key, value] of Object.entries(query))
    expect(origin.searchParams.get(key)).toBe(value);
  expect(origin.hash).toBe(`#history-event-quantity-${id}`);
});
