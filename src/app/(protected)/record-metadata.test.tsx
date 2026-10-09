import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const reads = vi.hoisted(() => ({
  asset: vi.fn(),
  quantity: vi.fn(),
  location: vi.fn(),
  site: vi.fn(),
  managed: vi.fn(),
  category: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
const auth = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: auth.member }));
vi.mock('@/features/inventory/queries.server', () => ({
  getAssetDetail: reads.asset,
  getQuantityDetail: reads.quantity,
  getLocation: reads.location,
}));
vi.mock('@/features/custody/queries.server', () => ({
  getSite: reads.site,
  getManagedLocations: reads.managed,
}));
vi.mock('@/features/configuration/queries.server', () => ({
  getConfigurationCategories: reads.category,
}));
vi.mock('@/features/metadata/metadata-settings', () => ({
  MetadataSettings: () => null,
}));
vi.mock('@/features/metadata/metadata-form', () => ({
  MetadataForm: () => null,
}));
vi.mock('@/features/inventory/components/detail-tasks', () => ({
  DetailTasks: () => null,
}));
vi.mock('@/features/custody/management-form', () => ({
  SiteManagementForm: () => null,
  LocationManagementForm: () => null,
}));
const routes = [
  {
    path: './inventory/assets/[id]/page',
    read: reads.asset,
    params: { id: 'opaque-asset' },
    title: 'Private asset · IT Inventory',
    value: { asset: { name: 'Private asset', status: 'retired' } },
  },
  {
    path: './inventory/quantity/[id]/page',
    read: reads.quantity,
    params: { id: 'opaque-quantity' },
    title: 'Private quantity · IT Inventory',
    value: { item: { name: 'Private quantity', archived: true } },
  },
  {
    path: './locations/[code]/page',
    read: reads.location,
    params: { code: 'PRIVATE-LOCATION' },
    title: 'Private location · Locations · IT Inventory',
    value: { name: 'Private location', active: false },
  },
  {
    path: './sites/[code]/page',
    read: reads.site,
    params: { code: 'PRIVATE-SITE' },
    title: 'Private site · Sites · IT Inventory',
    value: { name: 'Private site', active: false },
  },
  {
    path: './settings/sites/[code]/page',
    read: reads.site,
    params: { code: 'PRIVATE-SITE' },
    title: 'Private site · Site settings · IT Inventory',
    value: { name: 'Private site', active: false },
  },
  {
    path: './settings/locations/[code]/page',
    read: reads.managed,
    params: { code: 'PRIVATE-LOCATION' },
    title: 'Private location · Location settings · IT Inventory',
    value: [
      { code: 'PRIVATE-LOCATION', name: 'Private location', active: false },
    ],
  },
  {
    path: './settings/forms/[categoryId]/page',
    read: reads.category,
    params: { categoryId: 'opaque-category' },
    title: 'Private category form · Settings · IT Inventory',
    value: {
      categories: [
        {
          id: 'opaque-category',
          name: 'Private category',
          active: true,
          removed_at: null,
        },
      ],
      canManage: false,
      memberId: 'viewer',
    },
  },
  {
    path: './sites/[code]/open/[kind]/page',
    read: reads.site,
    params: { code: 'PRIVATE-SITE', kind: 'quantity' },
    title: 'Record existing quantity item at Private site · IT Inventory',
    value: { name: 'Private site', active: true },
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  auth.member.mockResolvedValue({ member: { role: 'staff' } });
});
it.each(routes)(
  'names the authorized record on $path including readable historical records',
  async ({ path, read, params, title, value }) => {
    read.mockResolvedValue(value);
    const page = await import(path);
    expect(
      await page.generateMetadata({ params: Promise.resolve(params) }),
    ).toEqual({ title: { absolute: title } });
    expect(read).toHaveBeenCalledOnce();
  },
);
it.each(routes)(
  'propagates auth redirects and read failures before producing any title on $path',
  async ({ path, read, params }) => {
    const page = await import(path);
    for (const message of [
      'LOGIN_REDIRECT',
      'INACTIVE_MEMBER_REDIRECT',
      'DATABASE_READ_FAILURE',
    ]) {
      const failure = new Error(message);
      read.mockRejectedValueOnce(failure);
      await expect(
        page.generateMetadata({ params: Promise.resolve(params) }),
      ).rejects.toBe(failure);
    }
  },
);
it.each(routes)(
  'uses notFound for a missing authorized record on $path',
  async ({ path, read, params }) => {
    read.mockResolvedValue(
      path.includes('settings/forms')
        ? { categories: [] }
        : path.includes('settings/locations')
          ? []
          : null,
    );
    const page = await import(path);
    await expect(
      page.generateMetadata({ params: Promise.resolve(params) }),
    ).rejects.toThrow('NOT_FOUND');
  },
);
it.each([
  { active: false, removed_at: null },
  { active: true, removed_at: '2026-10-09T00:00:00Z' },
])('does not name unavailable categories %j', async (status) => {
  reads.category.mockResolvedValue({
    categories: [
      { id: 'opaque-category', name: 'Private removed category', ...status },
    ],
  });
  const page = await import('./settings/forms/[categoryId]/page');
  await expect(
    page.generateMetadata({
      params: Promise.resolve({ categoryId: 'opaque-category' }),
    }),
  ).rejects.toThrow('NOT_FOUND');
});
it.each([
  { role: 'viewer', active: true },
  { role: 'staff', active: false },
])(
  'keeps denied site opening titles generic for %j',
  async ({ role, active }) => {
    auth.member.mockResolvedValue({ member: { role } });
    reads.site.mockResolvedValue({ name: 'Private site', active });
    const page = await import('./sites/[code]/open/[kind]/page');
    const result = await page.generateMetadata({
      params: Promise.resolve({ code: 'PRIVATE-SITE', kind: 'asset' }),
    });
    expect(result.title.absolute).toBe(
      'Record existing individual asset · IT Inventory',
    );
    expect(JSON.stringify(result)).not.toContain('Private site');
  },
);
