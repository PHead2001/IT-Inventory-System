// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  headers: new Headers(),
  reads: Array.from({ length: 8 }, () => vi.fn()),
}));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));
vi.mock('./inventory/quantity/[id]/read.server', () => ({
  readQuantityPage: state.reads[0],
}));
vi.mock('./inventory/assets/[id]/read.server', () => ({
  readAssetPage: state.reads[1],
}));
vi.mock('./locations/[code]/read.server', () => ({
  readLocationPage: state.reads[2],
}));
vi.mock('./sites/[code]/read.server', () => ({ readSitePage: state.reads[3] }));
vi.mock('./settings/sites/[code]/read.server', () => ({
  readManagedSitePage: state.reads[4],
}));
vi.mock('./settings/locations/[code]/read.server', () => ({
  readManagedLocationPage: state.reads[5],
}));
vi.mock('./settings/forms/[categoryId]/read.server', () => ({
  readCategoryFormPage: state.reads[6],
}));
vi.mock('./sites/[code]/open/[kind]/read.server', () => ({
  readSiteOpeningPage: state.reads[7],
}));
import { admitDocumentRecord } from './document-admission.server';
import { documentPathHeader, documentRecordRoute } from '@/lib/document-route';
const paths = [
  '/inventory/quantity/key',
  '/inventory/assets/key',
  '/locations/key',
  '/sites/key',
  '/settings/sites/key',
  '/settings/locations/key',
  '/settings/forms/key',
  '/sites/key/open/quantity',
];
beforeEach(() => {
  state.headers = new Headers();
  state.reads.forEach((read) =>
    read.mockReset().mockResolvedValue({
      active: false,
      site: { active: false },
      member: { role: 'viewer' },
      canManage: false,
    }),
  );
});
it.each(paths.map((path, index) => [path, index] as const))(
  'settles %s through its existing reader without treating readonly or archived as missing',
  async (path, index) => {
    state.headers.set(documentPathHeader, path);
    await expect(admitDocumentRecord()).resolves.toBe(false);
    expect(state.reads[index]).toHaveBeenCalledExactlyOnceWith('key');
    expect(state.reads.filter((read) => read.mock.calls.length)).toHaveLength(
      1,
    );
    state.reads[index].mockResolvedValue(index === 7 ? { site: null } : null);
    await expect(admitDocumentRecord()).resolves.toBe(true);
  },
);
it.each(paths)(
  'keeps %s Flight admission page-owned with zero document reads',
  async (path) => {
    state.headers.set(documentPathHeader, path);
    state.headers.set('rsc', '1');
    await expect(admitDocumentRecord()).resolves.toBe(false);
    state.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
  },
);
it.each([
  '/inventory/quantity/new',
  '/inventory/assets/new',
  '/inventory',
  '/locations',
  '/settings/forms',
  '/sites/key/extra',
  '/locations/key/open/asset',
  '/inventory/quantity/key/extra',
])('does not admit unrelated/static route %s', async (path) => {
  state.headers.set(documentPathHeader, path);
  await expect(admitDocumentRecord()).resolves.toBe(false);
  state.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
});
it('decodes exactly once, keeps suffixes, and rejects invalid opening kinds before site reads', async () => {
  state.headers.set(documentPathHeader, '/locations/A%20B.jpg');
  await admitDocumentRecord();
  expect(state.reads[2]).toHaveBeenCalledWith('A B.jpg');
  expect(documentRecordRoute('/locations/A%2520B')?.key).toBe('A%20B');
  expect(documentRecordRoute('/inventory/quantity/%6eew')?.key).toBe('new');
  state.headers.set(documentPathHeader, '/sites/key/open/invalid');
  await expect(admitDocumentRecord()).resolves.toBe(true);
  expect(state.reads[7]).not.toHaveBeenCalled();
});
it('propagates authorization and database failures without converting them into existence', async () => {
  state.headers.set(documentPathHeader, paths[0]);
  for (const error of [
    new Error('LOGIN_REDIRECT'),
    new Error('DATABASE_FAILURE'),
  ]) {
    state.reads[0].mockRejectedValue(error);
    await expect(admitDocumentRecord()).rejects.toBe(error);
  }
});

it.each(paths.map((path, index) => [path, index] as const))(
  'matches encoded identifiers and trailing slash for %s without a browser pathname grant',
  async (path, index) => {
    state.headers.set(documentPathHeader, path.replace('/key', '/%6bey') + '/');
    state.reads[index].mockResolvedValue(index === 7 ? { site: null } : null);
    await expect(admitDocumentRecord()).resolves.toBe(true);
    expect(state.reads[index]).toHaveBeenCalledExactlyOnceWith('key');
  },
);
