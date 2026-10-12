import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { signOutSession } from '@/lib/auth/logout-transport';
import { QueueLogoutForm } from './queue-logout-form';
import {
  clearAllDesignerRecovery,
  readDesignerRecovery,
  writeDesignerRecovery,
} from '@/features/metadata/designer-recovery';
import { clearLabelQueueSession } from './queue-model';
import { assignmentEpoch } from '@/features/scan/assign-batch';
const routing = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/test',
  useRouter: () => routing,
}));

vi.mock('@/lib/auth/actions', () => ({
  signOutSession: vi.fn(),
  readLogoutPrivacyGeneration: async () => ({ status: 'absent' }),
  acknowledgeLogoutPrivacyGeneration: async () => ({ status: 'match' }),
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  signOutSession: vi.fn(),
  readLogoutPrivacyGeneration: async () => ({ status: 'absent' }),
  acknowledgeLogoutPrivacyGeneration: async () => ({ status: 'match' }),
}));
vi.mock('@/lib/auth/logout-transport', () => ({
  signOutSession: vi.fn(),
  readLogoutPrivacyGeneration: async () => ({ status: 'absent' }),
  acknowledgeLogoutPrivacyGeneration: async () => ({ status: 'match' }),
}));
vi.mock('./queue-model', () => ({ clearLabelQueueSession: vi.fn() }));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = {
  memberId: id(1),
  categoryId: id(2),
  definition: { fields: [], layout: [] },
  savedDefinition: '',
  expectedDraftId: null,
  expectedDraftVersion: '0',
  expectedPublishedRevisionId: id(3),
  uncertainSave: true,
  receipt: { key: 'original command', id: id(4) },
};
beforeEach(() => {
  clearAllDesignerRecovery();
  vi.mocked(clearLabelQueueSession).mockClear();
  vi.mocked(clearLabelQueueSession).mockReturnValue(true);
  vi.mocked(signOutSession).mockReset();
  vi.mocked(signOutSession).mockResolvedValue({
    ok: true,
    logoutGeneration: '00000000-0000-4000-8000-000000000001',
  });
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it('cancels signout without removing unknown recovery or label session data', () => {
  writeDesignerRecovery(snapshot);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<QueueLogoutForm />);
  expect(
    fireEvent.submit(
      screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
    ),
  ).toBe(false);
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('does not undo a save that may have committed'),
  );
  expect(readDesignerRecovery(id(1), id(2)).item).toEqual(snapshot);
  expect(clearLabelQueueSession).not.toHaveBeenCalled();
  expect(signOutSession).not.toHaveBeenCalled();
});
it('allows explicit confirmed signout and removes even non-durable original recovery', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  writeDesignerRecovery(snapshot);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<QueueLogoutForm />);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  await waitFor(() => expect(signOutSession).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull(),
  );
  await waitFor(() => expect(clearLabelQueueSession).toHaveBeenCalledTimes(2));
});
it('signs out without confirmation for a definitely unsaved draft and clears it after success', async () => {
  writeDesignerRecovery({ ...snapshot, uncertainSave: false });
  const confirm = vi.spyOn(window, 'confirm');
  render(<QueueLogoutForm />);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  expect(confirm).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull(),
  );
});
it('clears uncertain scan recovery only after successful server signout away from Scan', async () => {
  sessionStorage.setItem('inventory-assign-batch-v1:old', 'private ticket');
  sessionStorage.setItem('inventory-assign-v1:old', 'exact original command');
  let finish!: (result: {
    ok: true;
    logoutGeneration: '00000000-0000-4000-8000-000000000001';
  }) => void;
  vi.mocked(signOutSession).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<QueueLogoutForm />);
  const captured = assignmentEpoch();
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  await waitFor(() => expect(signOutSession).toHaveBeenCalledOnce());
  expect(assignmentEpoch()).toBeGreaterThan(captured);
  expect(sessionStorage.getItem('inventory-assign-batch-v1:old')).toBe(
    'private ticket',
  );
  expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe(
    'exact original command',
  );
  finish({
    ok: true,
    logoutGeneration: '00000000-0000-4000-8000-000000000001',
  });
  await waitFor(() =>
    expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull(),
  );
  expect(routing.replace).toHaveBeenCalledWith('/login');
});
it.each(['server', 'transport'])(
  'preserves exact uncertain recovery after %s logout failure and offers retry',
  async (failure) => {
    writeDesignerRecovery(snapshot);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    sessionStorage.setItem(
      'inventory-assign-batch-v1:old',
      'settled checklist and PRIVATE ticket',
    );
    sessionStorage.setItem('inventory-assign-v1:old', 'exact original command');
    if (failure === 'server')
      vi.mocked(signOutSession).mockResolvedValue({
        ok: false,
        message: 'Unable to sign out. Please try again.',
      });
    else vi.mocked(signOutSession).mockRejectedValue(new Error('network'));
    render(<QueueLogoutForm />);
    fireEvent.submit(
      screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
    );
    await screen.findByRole('alert');
    expect(readDesignerRecovery(id(1), id(2)).item).toEqual(snapshot);
    expect(sessionStorage.getItem('inventory-assign-batch-v1:old')).toBe(
      'settled checklist and PRIVATE ticket',
    );
    expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe(
      'exact original command',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    vi.mocked(signOutSession).mockResolvedValue({
      ok: true,
      logoutGeneration: '00000000-0000-4000-8000-000000000001',
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
    );
    await waitFor(() =>
      expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull(),
    );
    expect(sessionStorage.getItem('inventory-assign-batch-v1:old')).toBeNull();
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
  },
);
it('keeps the original designer request until a confirmed receipt arrives', async () => {
  writeDesignerRecovery(snapshot);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let finish!: (result: { ok: true; logoutGeneration: string }) => void;
  vi.mocked(signOutSession).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<QueueLogoutForm />);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  await waitFor(() => expect(signOutSession).toHaveBeenCalledOnce());
  expect(readDesignerRecovery(id(1), id(2)).item).toEqual(snapshot);
  finish({ ok: true, logoutGeneration: id(1) });
  await waitFor(() =>
    expect(readDesignerRecovery(id(1), id(2)).item).toBeNull(),
  );
  expect(routing.replace).toHaveBeenCalledWith('/login');
});
it('blocks navigation until designer storage erasure is verified and retries cleanup only', async () => {
  writeDesignerRecovery(snapshot);
  const storageKey = Array.from({ length: sessionStorage.length }, (_, index) =>
    sessionStorage.key(index)!,
  ).find((key) => key.startsWith('it-inventory:form-designer:v1:'))!;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const remove = Storage.prototype.removeItem;
  const denied = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key !== storageKey) remove.call(this, key);
    });
  routing.replace.mockClear();
  render(<QueueLogoutForm />);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('could not clear');
  expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  expect(routing.replace).not.toHaveBeenCalled();
  expect(signOutSession).toHaveBeenCalledOnce();
  denied.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Finish signing out' }));
  await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
  expect(routing.replace).toHaveBeenCalledWith('/login');
  expect(signOutSession).toHaveBeenCalledOnce();
});
it('retries only privacy cleanup after confirmed signout when a private command removal fails', async () => {
  const command = 'inventory-assign-v1:cleanup-retry';
  sessionStorage.setItem(command, 'exact original command');
  const remove = Storage.prototype.removeItem;
  const denied = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === command) return;
      remove.call(this, key);
    });
  render(<QueueLogoutForm />);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('could not clear');
  expect(
    screen.queryByRole('button', { name: 'Sign out' }),
  ).not.toBeInTheDocument();
  expect(signOutSession).toHaveBeenCalledOnce();
  denied.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Finish signing out' }));
  await waitFor(() => expect(sessionStorage.getItem(command)).toBeNull());
  expect(signOutSession).toHaveBeenCalledOnce();
});
