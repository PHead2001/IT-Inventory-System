import { expect, it, vi } from 'vitest';
import { cleanupInterfaceFixture } from '../helpers/interface-fixture-cleanup';

it('attempts category cleanup and sign-out after record cleanup fails', async () => {
  const recordError = new Error('Record cleanup failed');
  const category = vi.fn(async () => {});
  const signOut = vi.fn(async () => {});
  await expect(
    cleanupInterfaceFixture({
      record: async () => {
        throw recordError;
      },
      category,
      signOut,
    }),
  ).rejects.toMatchObject({ errors: [recordError] });
  expect(category).toHaveBeenCalledOnce();
  expect(signOut).toHaveBeenCalledOnce();
});

it('retains every independent failure, including sign-out failure', async () => {
  const failures = [
    new Error('Record'),
    new Error('Category'),
    new Error('Session'),
  ];
  await expect(
    cleanupInterfaceFixture({
      record: async () => {
        throw failures[0];
      },
      category: async () => {
        throw failures[1];
      },
      signOut: async () => {
        throw failures[2];
      },
    }),
  ).rejects.toMatchObject({ errors: failures });
});

it('removes record before category and signs out last on successful cleanup', async () => {
  const calls: string[] = [];
  await cleanupInterfaceFixture({
    record: async () => {
      calls.push('record');
    },
    category: async () => {
      calls.push('category');
    },
    signOut: async () => {
      calls.push('session');
    },
  });
  expect(calls).toEqual(['record', 'category', 'session']);
});
