import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SettingsPage from './page';
import FormsPage from './forms/page';
import CategoryFormPage from './forms/[categoryId]/page';
import LabelSettingsPage from './labels/page';
import { SettingsNavigation } from './settings-navigation';

const mocks = vi.hoisted(() => ({
  categories: vi.fn(),
  labels: vi.fn(),
  forms: vi.fn(),
  pathname: '/settings',
  redirect: vi.fn(),
  notFound: vi.fn(),
  designer: vi.fn(),
}));
vi.mock('@/features/configuration/queries.server', () => ({
  getConfigurationCategories: mocks.categories,
  getLabelSettings: mocks.labels,
}));
vi.mock('@/features/metadata/queries.server', () => ({
  getPublishedForms: mocks.forms,
}));
vi.mock('@/features/metadata/metadata-settings', () => ({
  MetadataSettings: (props: unknown) => {
    mocks.designer(props);
    return <div>Selected form designer</div>;
  },
}));
vi.mock('@/features/configuration/settings-panel', () => ({
  SettingsPanel: () => <div>Configuration controls</div>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

const id = '00000000-0000-4000-8000-000000000001';
const category = {
  id,
  code: 'TOOLS',
  name: 'Tools',
  active: true,
  removed_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = '/settings';
  mocks.categories.mockResolvedValue({
    categories: [category],
    canManage: true,
    memberId: id,
  });
  mocks.labels.mockResolvedValue({
    labelDefaults: {
      size: '90x50',
      page: 'letter',
      format: 'qr',
      version: '1',
    },
    canManage: true,
  });
  mocks.forms.mockResolvedValue({ [id]: {} });
  mocks.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

it('keeps landing, form chooser and label defaults independent of form definitions', async () => {
  render(await SettingsPage({}));
  expect(screen.getByRole('link', { name: /Categories/ })).toHaveAttribute(
    'href',
    '/settings/categories',
  );
  render(await FormsPage());
  expect(screen.getByRole('link', { name: 'Tools' })).toHaveAttribute(
    'href',
    `/settings/forms/${id}`,
  );
  await LabelSettingsPage();
  expect(mocks.forms).not.toHaveBeenCalled();
  expect(mocks.labels).toHaveBeenCalledOnce();
});

it('loads only the selected active category form for an editor', async () => {
  mocks.categories.mockResolvedValue({
    categories: [
      category,
      {
        ...category,
        id: '00000000-0000-4000-8000-000000000020',
        name: 'Adapters',
      },
      { ...category, active: false, name: 'Archived' },
    ],
    canManage: true,
    memberId: id,
  });
  render(
    await CategoryFormPage({ params: Promise.resolve({ categoryId: id }) }),
  );
  expect(mocks.forms).toHaveBeenCalledExactlyOnceWith([id]);
  expect(screen.getByText('Selected form designer')).toBeVisible();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Tools form' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'All category forms' }),
  ).toHaveAttribute('href', '/settings/forms');
  expect(mocks.designer).toHaveBeenCalledWith(
    expect.objectContaining({
      selectedCategoryId: id,
      categories: [
        { id, name: 'Tools', active: true },
        {
          id: '00000000-0000-4000-8000-000000000020',
          name: 'Adapters',
          active: true,
        },
      ],
    }),
  );
});

it('offers browser-personal motion preferences on the member Settings landing page', async () => {
  render(await SettingsPage({}));
  expect(
    screen.getByRole('region', { name: 'Appearance & preferences' }),
  ).toHaveTextContent('personal preference for this browser');
  expect(
    screen.getByRole('switch', { name: 'Reduce motion in this browser' }),
  ).toBeVisible();
  expect(mocks.categories).not.toHaveBeenCalled();
});

it('does not fetch a form for viewers or inactive category links', async () => {
  mocks.categories.mockResolvedValueOnce({
    categories: [category],
    canManage: false,
    memberId: id,
  });
  render(
    await CategoryFormPage({ params: Promise.resolve({ categoryId: id }) }),
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'requires an active staff membership',
  );
  expect(mocks.forms).not.toHaveBeenCalled();
  await expect(
    CategoryFormPage({ params: Promise.resolve({ categoryId: 'missing' }) }),
  ).rejects.toThrow('NEXT_NOT_FOUND');
  expect(mocks.forms).not.toHaveBeenCalled();
});

it('marks nested form routes active and accepts legacy category links', async () => {
  mocks.pathname = `/settings/forms/${id}`;
  render(<SettingsNavigation />);
  expect(screen.getByRole('link', { name: 'Forms & fields' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    SettingsPage({ searchParams: Promise.resolve({ category: id }) }),
  ).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledWith(`/settings/forms/${id}`);
});
