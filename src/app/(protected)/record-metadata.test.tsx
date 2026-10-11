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
    generic: 'Individual asset · IT Inventory',
    read: reads.asset,
    params: { id: 'opaque-asset' },
    title: 'Private asset · IT Inventory',
    value: { asset: { name: 'Private asset', status: 'retired' } },
  },
  {
    path: './inventory/quantity/[id]/page',
    generic: 'Quantity item · IT Inventory',
    read: reads.quantity,
    params: { id: 'opaque-quantity' },
    title: 'Private quantity · IT Inventory',
    value: { item: { name: 'Private quantity', archived: true } },
  },
  {
    path: './locations/[code]/page',
    generic: 'Location details · IT Inventory',
    read: reads.location,
    params: { code: 'PRIVATE-LOCATION' },
    title: 'Private location · Locations · IT Inventory',
    value: { name: 'Private location', active: false },
  },
  {
    path: './sites/[code]/page',
    generic: 'Site details · IT Inventory',
    read: reads.site,
    params: { code: 'PRIVATE-SITE' },
    title: 'Private site · Sites · IT Inventory',
    value: { name: 'Private site', active: false },
  },
  {
    path: './settings/sites/[code]/page',
    generic: 'Site details and settings · IT Inventory',
    read: reads.site,
    params: { code: 'PRIVATE-SITE' },
    title: 'Private site · Site settings · IT Inventory',
    value: { name: 'Private site', active: false },
  },
  {
    path: './settings/locations/[code]/page',
    generic: 'Rename location · IT Inventory',
    read: reads.managed,
    params: { code: 'PRIVATE-LOCATION' },
    title: 'Private location · Location settings · IT Inventory',
    value: [
      { code: 'PRIVATE-LOCATION', name: 'Private location', active: false },
    ],
  },
  {
    path: './settings/forms/[categoryId]/page',
    generic: 'Category forms · IT Inventory',
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
    generic: 'Record existing quantity item · IT Inventory',
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
  'keeps streamed metadata generic and read-free on $path, including denied or failed reads',
  async ({ path, read, params, title, value, generic }) => {
    const page = await import(path);
    for (const outcome of [
      value,
      null,
      new Error('LOGIN_REDIRECT'),
      new Error('DATABASE_READ_FAILURE'),
    ]) {
      if (outcome instanceof Error) read.mockRejectedValue(outcome);
      else read.mockResolvedValue(outcome);
      const metadata = await page.generateMetadata({
        params: Promise.resolve(params),
      });
      expect(metadata.title.absolute).toBe(generic);
      expect(metadata.title.absolute).not.toBe(title);
      expect(JSON.stringify(metadata)).not.toContain('Private');
      expect(JSON.stringify(metadata)).not.toContain('opaque-');
      expect(read).not.toHaveBeenCalled();
      expect(auth.member).not.toHaveBeenCalled();
    }
  },
);
