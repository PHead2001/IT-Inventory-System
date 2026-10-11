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
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  history: vi.fn(),
  identity: vi.fn(),
  redirect: vi.fn(),
  custom: vi.fn(),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getHistory: m.history,
  getHistoryRecord: m.identity,
  getLocations: async () => [],
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getEventCustomPage: m.custom,
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  redirect: m.redirect,
  useRouter: () => ({ push: vi.fn() }),
}));
import Page from './page';
import { OperationalTimeProvider } from '@/components/operational-time';
import * as operationalTime from '@/lib/operational-time';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  m.history.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
  m.identity.mockResolvedValue({ id, name: 'Adapters', kind: 'quantity' });
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
