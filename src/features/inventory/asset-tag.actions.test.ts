import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ member: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: mocks.member }));
import { checkAssetTag } from './asset-tag.actions';
const id = '70000000-0000-4000-8000-000000000001';
const row = {
  id,
  name: 'Named equipment',
  asset_tag: 'İΣ-Ab',
  status: 'active',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: row, error: null });
});
it('passes raw trimmed spelling to PostgreSQL and returns truthful active/retired identity', async () => {
  expect(await checkAssetTag('  İΣ-Ab  ')).toEqual(row);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'inventory_asset_tag_lookup',
    { p_tag: 'İΣ-Ab' },
  );
  mocks.rpc.mockResolvedValue({
    data: { ...row, status: 'retired' },
    error: null,
  });
  expect(await checkAssetTag('İΣ-Ab')).toMatchObject({ status: 'retired' });
});
it('excludes only the edited asset and treats unknown or empty tags as no conflict', async () => {
  expect(await checkAssetTag('İΣ-Ab', id)).toBeNull();
  expect(
    await checkAssetTag('İΣ-Ab', '70000000-0000-4000-8000-000000000002'),
  ).toEqual(row);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect(await checkAssetTag('New tag')).toBeNull();
  mocks.rpc.mockClear();
  expect(await checkAssetTag('   ')).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('requires current membership for direct private access before invoking the lookup', async () => {
  mocks.member.mockRejectedValue(new Error('Active member required'));
  await expect(checkAssetTag('Existing')).rejects.toThrow(
    'Active member required',
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('invalid inputs and failed lookup never return a false clear result', async () => {
  for (const [tag, exclude] of [
    ['x'.repeat(101), undefined],
    ['tag\ntext', undefined],
    ['tag', 'not-an-id'],
  ])
    await expect(checkAssetTag(tag!, exclude)).rejects.toThrow(
      'Asset tag could not be checked',
    );
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: 'PRIVATE_DATABASE_ERROR' },
  });
  await expect(checkAssetTag('tag')).rejects.toThrow(
    /^Asset tag could not be checked\.$/,
  );
});
