import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ScanPage from './page';
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  sites: vi.fn(),
  locations: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('@/features/custody/queries.server', () => ({ getSites: mocks.sites }));
vi.mock('@/features/inventory/queries.server', () => ({
  getLocations: mocks.locations,
}));
vi.mock('@/features/scan/assign-workspace', () => ({
  AssignmentWorkspace: (props: unknown) => {
    mocks.workspace(props);
    return <p>Assignment workspace</p>;
  },
}));
vi.mock('@/features/scan/scan-panel', () => ({
  ScanPanel: () => <p>Ordinary scan panel</p>,
}));
const site = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Headquarters',
  active: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({
    member: {
      role: 'staff',
      active: true,
      user_id: '00000000-0000-4000-8000-000000000002',
    },
  });
  mocks.sites.mockResolvedValue([site]);
  mocks.locations.mockResolvedValue([]);
});
it('keeps ordinary scan-to-open free of assignment loading', async () => {
  render(await ScanPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText('Ordinary scan panel')).toBeVisible();
  expect(mocks.sites).not.toHaveBeenCalled();
  expect(mocks.locations).not.toHaveBeenCalled();
  expect(mocks.workspace).not.toHaveBeenCalled();
});
it('loads only an authorized active destination without any mutation on open', async () => {
  render(
    await ScanPage({
      searchParams: Promise.resolve({ mode: 'assign', site: site.id }),
    }),
  );
  expect(mocks.workspace).toHaveBeenCalledWith(
    expect.objectContaining({ initialSiteId: site.id, siteIssue: undefined }),
  );
  expect(mocks.sites).toHaveBeenCalledOnce();
  expect(mocks.locations).toHaveBeenCalledOnce();
});
it.each(['unknown', site.id])(
  'does not preselect invalid or archived destination %s',
  async (id) => {
    mocks.sites.mockResolvedValue([{ ...site, active: false }]);
    render(
      await ScanPage({
        searchParams: Promise.resolve({ mode: 'assign', site: id }),
      }),
    );
    expect(mocks.workspace).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSiteId: undefined,
        siteIssue: expect.stringContaining('unavailable or archived'),
      }),
    );
  },
);
it('denies viewer assignment entry before loading batch references', async () => {
  mocks.member.mockResolvedValue({ member: { role: 'viewer', active: true } });
  render(
    await ScanPage({
      searchParams: Promise.resolve({ mode: 'assign', site: site.id }),
    }),
  );
  expect(
    screen.getByText(/Assignment requires an active staff account/),
  ).toBeVisible();
  expect(mocks.sites).not.toHaveBeenCalled();
  expect(mocks.workspace).not.toHaveBeenCalled();
});
