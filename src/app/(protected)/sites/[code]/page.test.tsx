vi.mock('server-only', () => ({}));
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SitePage from './page';
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  site: vi.fn(),
  detail: vi.fn(),
  archive: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('@/features/custody/queries.server', () => ({
  getSite: mocks.site,
  getSiteDetail: mocks.detail,
  getSiteArchiveReview: mocks.archive,
}));
vi.mock('@/features/custody/management-form', () => ({
  SiteManagementForm: () => <p>Manage site form</p>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: vi.fn(),
}));
const site = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'HQ',
  name: 'Headquarters',
  active: true,
  version: '1',
  notes: null,
};
const zero = '0';
const summary = {
  site_id: site.id,
  current_quantity_units: zero,
  current_serialized_assets: zero,
  quantity: {
    gross_issued_units: zero,
    return_units: zero,
    transfer_in_units: zero,
    transfer_out_units: zero,
    opening_units: zero,
    write_off_units: zero,
  },
  serialized: {
    gross_storage_issue_events: zero,
    unique_issued_assets: zero,
    return_events: zero,
    opening_events: zero,
    retirement_events: zero,
  },
};
const detail = {
  summary,
  holdings: [],
  holdingTotal: 0,
  page: 1,
  groups: { rows: [], total: 0 },
  events: [],
  eventTotal: 0,
  from: null,
  until: null,
  activityErrors: {},
  activityValid: true,
};
beforeEach(() => {
  mocks.member.mockResolvedValue({
    member: {
      user_id: '00000000-0000-4000-8000-000000000002',
      role: 'staff',
      can_manage_configuration: true,
    },
  });
  mocks.site.mockResolvedValue(site);
  mocks.detail.mockResolvedValue(detail);
  mocks.archive.mockResolvedValue({ holdings: [], total: 0 });
});
async function renderPage(filters = {}) {
  render(
    await SitePage({
      params: Promise.resolve({ code: 'HQ' }),
      searchParams: Promise.resolve(filters),
    }),
  );
}
it('shows accurate first-use copy and site-first issuing without duplicate filtered-empty copy', async () => {
  await renderPage();
  expect(
    screen.getByText('No equipment is currently assigned to this site.'),
  ).toBeVisible();
  expect(
    screen.queryByText('No current holdings match these filters.'),
  ).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Issue existing stock' }),
  ).toHaveAttribute('href', `/scan?mode=assign&site=${site.id}`);
  expect(
    screen.getByText('Activity breakdown · 0 events').closest('details'),
  ).not.toHaveAttribute('open');
});
it('distinguishes a filtered zero from a genuinely empty site', async () => {
  mocks.detail.mockResolvedValue({
    ...detail,
    summary: { ...summary, current_quantity_units: '8' },
  });
  await renderPage({ q: 'unmatched', kind: 'asset' });
  expect(
    screen.getByText('No current holdings match these filters.'),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Clear holdings filters' }),
  ).toHaveAttribute('href', '/sites/HQ#site-holdings');
  expect(
    screen.queryByText('No equipment is currently assigned to this site.'),
  ).toBeNull();
});
it('keeps invalid activity filtering within the site shell and suppresses misleading empty results/metrics', async () => {
  mocks.detail.mockResolvedValue({
    ...detail,
    activityValid: false,
    activityErrors: { until: 'Until must be later than From.' },
  });
  await renderPage({ from: '2026-10-08T00:00', until: '2026-10-07T00:00' });
  expect(screen.getByRole('heading', { name: site.name })).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Current holdings' }),
  ).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Check the activity date filters',
  );
  expect(screen.queryByText('No activity in this date range.')).toBeNull();
  expect(screen.queryByText('Activity breakdown · 0 events')).toBeNull();
});
it('offers archived-site guidance and does not issue to an archived site', async () => {
  mocks.site.mockResolvedValue({ ...site, active: false });
  await renderPage();
  expect(
    screen.getByText('This archived site has no current holdings.'),
  ).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Issue existing stock' }),
  ).toBeNull();
  expect(screen.getByText(/Restore the site under Manage site/)).toBeVisible();
});
it('keeps viewer first-use guidance read-only', async () => {
  mocks.member.mockResolvedValue({
    member: { role: 'viewer', can_manage_configuration: false },
  });
  await renderPage();
  expect(
    screen.queryByRole('link', { name: 'Issue existing stock' }),
  ).toBeNull();
  expect(
    screen.getByText(
      'Staff can issue existing stock or record equipment already at the site.',
    ),
  ).toBeVisible();
});
it('labels a quantity count correction at its recorded site without movement or unsigned amount', async () => {
  mocks.detail.mockResolvedValue({
    ...detail,
    events: [
      {
        id: 'correction',
        item_id: 'item',
        asset_id: null,
        kind: 'corrected',
        actor_name: 'Staff',
        created_at: '2026-10-07T12:00:00Z',
        from_label: 'Historical site',
        to_label: null,
        quantity: 5,
        reason: 'Count checked',
        reference: null,
      },
    ],
    eventTotal: 1,
  });
  await renderPage();
  const row = screen.getByRole('link', { name: 'View record' }).closest('li');
  expect(row).toHaveTextContent('Count corrected at Historical site');
  expect(row).not.toHaveTextContent('→');
  expect(row).not.toHaveTextContent('No destination');
  expect(row).not.toHaveTextContent('5 units');
});
vi.mock('server-only', () => ({}));
