import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  getPublishedForm: vi.fn(),
  describeValues: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
vi.mock('./queries.server', () => ({
  getPublishedForm: mocks.getPublishedForm,
  describeValues: mocks.describeValues,
}));
import { refreshMetadataRecord } from './record-refresh.actions';
const id = '00000000-0000-4000-8000-000000000001';
const category = '00000000-0000-4000-8000-000000000002';
const actor = '00000000-0000-4000-8000-000000000003';
const row = {
  id,
  name: 'Saved cable',
  description: null,
  category_id: category,
  manufacturer: 'Canonical maker',
  model: null,
  version: 2,
  custom_values: {},
  archived: false,
  item_code: null,
  reorder_threshold: 0,
};
beforeEach(() => {
  vi.resetAllMocks();
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(builder);
  mocks.requireMember.mockResolvedValue({
    member: { user_id: actor },
    supabase: { from: mocks.from },
  });
  mocks.maybeSingle
    .mockResolvedValueOnce({ data: row, error: null })
    .mockResolvedValueOnce({ data: { name: 'Parts' }, error: null });
  mocks.getPublishedForm.mockResolvedValue({ category_id: category });
  mocks.describeValues.mockResolvedValue({});
});
it('reads the full canonical baseline with current caller membership, then its form', async () => {
  const result = await refreshMetadataRecord('quantity', id, actor);
  expect(result).toMatchObject({
    ok: true,
    record: {
      id,
      version: 2,
      name: 'Saved cable',
      manufacturer: 'Canonical maker',
      reorderThreshold: 0,
      categoryName: 'Parts',
    },
    form: { category_id: category },
  });
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
    'quantity_items',
    'categories',
  ]);
  expect(mocks.requireMember).toHaveBeenCalledOnce();
  expect(mocks.getPublishedForm).toHaveBeenCalledExactlyOnceWith(category);
});
it('does not expose another actor context after switching accounts', async () => {
  expect(await refreshMetadataRecord('quantity', id, category)).toMatchObject({
    ok: false,
    message: expect.stringContaining('staff member changed'),
  });
  expect(mocks.from).not.toHaveBeenCalled();
});
it('does not read without current membership', async () => {
  mocks.requireMember.mockRejectedValue(new Error('Access denied'));
  await expect(refreshMetadataRecord('quantity', id, actor)).rejects.toThrow(
    'Access denied',
  );
  expect(mocks.from).not.toHaveBeenCalled();
});
it('validates record and draft category identifiers before reading', async () => {
  expect(
    await refreshMetadataRecord('quantity', 'invalid', actor),
  ).toMatchObject({ ok: false });
  expect(
    await refreshMetadataRecord('quantity', id, actor, 'invalid'),
  ).toMatchObject({ ok: false });
  expect(mocks.from).not.toHaveBeenCalled();
});
it('loads the draft category separately when a pending category change needs reconciliation', async () => {
  await refreshMetadataRecord('quantity', id, actor, actor);
  expect(mocks.getPublishedForm.mock.calls).toEqual([[category], [actor]]);
});
it('returns a refresh error without exposing provider details', async () => {
  mocks.maybeSingle.mockReset().mockResolvedValue({
    data: null,
    error: { message: 'private database detail' },
  });
  expect(await refreshMetadataRecord('quantity', id, actor)).toEqual({
    ok: false,
    message: 'The current record could not be loaded. Retry.',
  });
});
