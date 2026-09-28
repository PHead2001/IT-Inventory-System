import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  site: vi.fn(),
  sites: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
vi.mock('@/features/custody/queries.server', () => ({
  getSite: mocks.site,
  getSites: mocks.sites,
}));
vi.mock('@/features/custody/management-form', () => ({
  SiteManagementForm: ({ site }: { site?: { code: string } }) => (
    <p>Edit {site?.code ?? 'new site'}</p>
  ),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
import ManageSitesPage from '../page';
import ManageSitePage from './page';

const site = {
  id: 'site-id',
  code: 'HQ',
  name: 'Headquarters',
  notes: null,
  active: true,
  version: 3,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({
    member: { role: 'staff', can_manage_configuration: true },
  });
  mocks.site.mockResolvedValue(site);
  mocks.sites.mockResolvedValue([site]);
  mocks.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
});
it('links settings listing to a live site editor and keeps daily holdings separate', async () => {
  render(await ManageSitesPage());
  expect(
    screen.getByRole('link', { name: 'Headquarters (HQ)' }),
  ).toHaveAttribute('href', '/settings/sites/HQ');
  render(await ManageSitePage({ params: Promise.resolve({ code: 'HQ' }) }));
  expect(screen.getByText('Edit HQ')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'View site holdings' }),
  ).toHaveAttribute('href', '/sites/HQ');
  expect(mocks.site).toHaveBeenCalledWith('HQ');
});
it('shows read-only state to a viewer and rejects missing sites', async () => {
  mocks.member.mockResolvedValueOnce({
    member: { role: 'viewer', can_manage_configuration: false },
  });
  render(await ManageSitePage({ params: Promise.resolve({ code: 'HQ' }) }));
  expect(
    screen.getByText('This site is read-only for your account.'),
  ).toBeVisible();
  mocks.site.mockResolvedValueOnce(null);
  await expect(
    ManageSitePage({ params: Promise.resolve({ code: 'MISSING' }) }),
  ).rejects.toThrow('NOT_FOUND');
});
