import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  getPublishedForm: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: mocks.requireMember,
}));
vi.mock('./queries.server', () => ({
  getPublishedForm: mocks.getPublishedForm,
}));

import { fetchCategoryForm } from './form-fetch.actions';

const categoryId = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireMember.mockResolvedValue({
    member: { role: 'staff', active: true },
  });
});

it('checks current membership and fetches only the requested category', async () => {
  const form = { category_id: categoryId, published_revision_id: null };
  mocks.getPublishedForm.mockResolvedValue(form);
  await expect(fetchCategoryForm(categoryId)).resolves.toEqual({
    ok: true,
    form,
  });
  expect(mocks.requireMember).toHaveBeenCalledTimes(1);
  expect(mocks.getPublishedForm).toHaveBeenCalledExactlyOnceWith(categoryId);
});

it('rejects a malformed category without issuing a form read', async () => {
  await expect(fetchCategoryForm('not-an-id')).resolves.toEqual({
    ok: false,
    message: 'Choose a valid category.',
  });
  expect(mocks.requireMember).toHaveBeenCalledTimes(1);
  expect(mocks.getPublishedForm).not.toHaveBeenCalled();
});

it('does not read a form when the current authorization fails', async () => {
  mocks.requireMember.mockRejectedValue(new Error('access denied'));
  await expect(fetchCategoryForm(categoryId)).rejects.toThrow('access denied');
  expect(mocks.getPublishedForm).not.toHaveBeenCalled();
});

it('returns a retryable generic error after an authorized read failure', async () => {
  mocks.getPublishedForm.mockRejectedValue(
    new Error('database private detail'),
  );
  await expect(fetchCategoryForm(categoryId)).resolves.toEqual({
    ok: false,
    message: 'The selected category form could not be loaded. Retry.',
  });
});
