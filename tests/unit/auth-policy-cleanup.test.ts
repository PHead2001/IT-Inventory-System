import { expect, it, vi } from 'vitest';
import { withAuthPolicyCleanup } from '../helpers/auth-policy-cleanup';

it.each(['throw', 'error result'])(
  'continues every deletion after a %s and sanitizes cleanup failures',
  async (failure) => {
    const remove = vi.fn(async (id: string) => {
      if (id === 'owned-first') {
        if (failure === 'throw') throw new Error('private provider diagnostic');
        return { error: { message: 'private provider diagnostic' } };
      }
      return { error: null };
    });
    const error = await withAuthPolicyCleanup(
      ['owned-first', 'owned-second'],
      remove,
      async () => {},
    ).catch((error) => error);
    expect(remove.mock.calls).toEqual([['owned-first'], ['owned-second']]);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((entry: Error) => entry.message)).toEqual([
      'Disposable Auth cleanup failed (owned account 1)',
    ]);
    expect(String(error)).not.toContain('private provider diagnostic');
  },
);
it('retains the original test failure while aggregating all cleanup failures', async () => {
  const original = new Error('Original policy assertion');
  const remove = vi
    .fn()
    .mockRejectedValue(new Error('private cleanup diagnostic'));
  const error = await withAuthPolicyCleanup(
    ['first', 'second'],
    remove,
    async () => {
      throw original;
    },
  ).catch((error) => error);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(error.errors[0]).toBe(original);
  expect(error.errors).toHaveLength(3);
  expect(error.errors.slice(1).map((entry: Error) => entry.message)).toEqual([
    'Disposable Auth cleanup failed (owned account 1)',
    'Disposable Auth cleanup failed (owned account 2)',
  ]);
});
it('rethrows the original failure unchanged after successful cleanup', async () => {
  const original = new Error('Original policy assertion');
  const ids: string[] = [];
  const remove = vi.fn().mockResolvedValue({ error: null });
  await expect(
    withAuthPolicyCleanup(ids, remove, async () => {
      ids.push('created-before-failure');
      throw original;
    }),
  ).rejects.toBe(original);
  expect(remove).toHaveBeenCalledWith('created-before-failure');
});
it('resolves only after all owned accounts are removed', async () => {
  const remove = vi.fn().mockResolvedValue({ error: null });
  await expect(
    withAuthPolicyCleanup(['first', 'second'], remove, async () => {}),
  ).resolves.toBeUndefined();
  expect(remove.mock.calls).toEqual([['first'], ['second']]);
});
