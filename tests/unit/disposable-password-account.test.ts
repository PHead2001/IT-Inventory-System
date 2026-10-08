import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { withDisposablePasswordAccount } from '../e2e/disposable-password-account';

function fixture() {
  const calls: string[] = [];
  const membershipInsert = vi.fn(async () => {
    calls.push('insert');
    return { error: null as null | object };
  });
  const membershipDelete = vi.fn(async () => {
    calls.push('delete membership');
    return { error: null as null | object };
  });
  const membershipRead = vi.fn(async () => {
    calls.push('verify membership');
    return { error: null, data: null as null | object };
  });
  const createUser = vi.fn(async () => ({
    data: { user: { id: 'owned-user' } },
    error: null as null | object,
  }));
  const deleteUser = vi.fn(async () => {
    calls.push('delete Auth');
    return { error: null as null | object };
  });
  const getUserById = vi.fn(async () => {
    calls.push('verify Auth');
    return {
      data: { user: null as null | { id: string } },
      error: { status: 404 } as null | { status: number },
    };
  });
  const client = {
    auth: { admin: { createUser, deleteUser, getUserById } },
    from: vi.fn(() => ({
      insert: membershipInsert,
      delete: () => ({ eq: membershipDelete }),
      select: () => ({ eq: () => ({ maybeSingle: membershipRead }) }),
    })),
  } as unknown as SupabaseClient;
  const signOut = vi.fn(async () => {
    calls.push('sign out');
  });
  const run = (work: () => Promise<void>) =>
    withDisposablePasswordAccount(
      client,
      { email: 'owned@example.test', password: 'test-only' },
      signOut,
      work,
    );
  return {
    calls,
    client,
    createUser,
    membershipInsert,
    membershipDelete,
    membershipRead,
    deleteUser,
    getUserById,
    signOut,
    run,
  };
}

it('signs out and removes only the owned membership before Auth, then verifies absence', async () => {
  const f = fixture();
  await f.run(async () => {
    f.calls.push('password assertions');
  });
  expect(f.calls).toEqual([
    'insert',
    'password assertions',
    'sign out',
    'delete membership',
    'delete Auth',
    'verify membership',
    'verify Auth',
  ]);
  expect(f.membershipDelete).toHaveBeenCalledWith('user_id', 'owned-user');
  expect(f.deleteUser).toHaveBeenCalledWith('owned-user');
});

it('cleans up when a password assertion fails and preserves that failure', async () => {
  const f = fixture();
  await expect(
    f.run(async () => {
      throw new Error('Password assertion failed');
    }),
  ).rejects.toThrow('Password assertion failed');
  expect(f.deleteUser).toHaveBeenCalledWith('owned-user');
  expect(f.getUserById).toHaveBeenCalledWith('owned-user');
});

it('owns cleanup immediately after creation even if membership setup fails', async () => {
  const f = fixture();
  f.membershipInsert.mockResolvedValue({ error: {} });
  const work = vi.fn();
  await expect(f.run(work)).rejects.toThrow('membership could not be created');
  expect(work).not.toHaveBeenCalled();
  expect(f.signOut).toHaveBeenCalledOnce();
  expect(f.deleteUser).toHaveBeenCalledWith('owned-user');
});

it('attempts all removals and verification after sign-out or deletion failures', async () => {
  const f = fixture();
  f.signOut.mockRejectedValue(new Error('private provider detail'));
  f.membershipDelete.mockImplementation(async () => {
    f.calls.push('delete membership');
    return { error: {} };
  });
  f.deleteUser.mockImplementation(async () => {
    f.calls.push('delete Auth');
    return { error: {} };
  });
  await expect(f.run(async () => {})).rejects.toThrow(
    'Disposable password cleanup failed: session sign-out, membership removal, Auth removal',
  );
  expect(f.calls).toEqual([
    'insert',
    'delete membership',
    'delete Auth',
    'verify membership',
    'verify Auth',
  ]);
});

it('rejects a leftover membership instead of treating cleanup as successful', async () => {
  const f = fixture();
  f.membershipRead.mockResolvedValue({
    error: null,
    data: { user_id: 'owned-user' },
  });
  await expect(f.run(async () => {})).rejects.toThrow('membership absence');
  expect(f.getUserById).toHaveBeenCalledWith('owned-user');
});

it('does not remove any account when creation fails', async () => {
  const f = fixture();
  f.createUser.mockResolvedValue({
    data: { user: { id: 'unowned' } },
    error: {},
  });
  await expect(f.run(async () => {})).rejects.toThrow('could not be created');
  expect(f.signOut).not.toHaveBeenCalled();
  expect(f.deleteUser).not.toHaveBeenCalled();
});

it('rejects a leftover Auth user even when the deletion request reported success', async () => {
  const f = fixture();
  f.getUserById.mockResolvedValue({
    data: { user: { id: 'owned-user' } },
    error: null,
  });
  await expect(f.run(async () => {})).rejects.toThrow('Auth absence');
});
