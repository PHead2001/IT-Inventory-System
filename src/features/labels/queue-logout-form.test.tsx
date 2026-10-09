import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { signOutSession } from '@/lib/auth/actions';
import { QueueLogoutForm } from './queue-logout-form';
import {
  clearAllDesignerRecovery,
  readDesignerRecovery,
  writeDesignerRecovery,
} from '@/features/metadata/designer-recovery';
import { clearLabelQueueSession } from './queue-model';
import { assignmentEpoch } from '@/features/scan/assign-batch';
const routing = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => routing }));

vi.mock('@/lib/auth/actions', () => ({ signOutSession: vi.fn() }));
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
  vi.mocked(signOutSession).mockReset();
  vi.mocked(signOutSession).mockResolvedValue({ ok: true });
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
  expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
  expect(clearLabelQueueSession).toHaveBeenCalledOnce();
});
it('retains the existing direct signout behavior for a definitely unsaved draft', () => {
  writeDesignerRecovery({ ...snapshot, uncertainSave: false });
  const confirm = vi.spyOn(window, 'confirm');
  render(<QueueLogoutForm />);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(readDesignerRecovery(id(1), id(2)).item).toBeNull();
});
it('clears uncertain scan recovery only after successful server signout away from Scan', async () => {
  sessionStorage.setItem('inventory-assign-batch-v1:old', 'private ticket');
  sessionStorage.setItem('inventory-assign-v1:old', 'exact original command');
  let finish!: (result: { ok: true }) => void;
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
  finish({ ok: true });
  await waitFor(() =>
    expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull(),
  );
  expect(routing.replace).toHaveBeenCalledWith('/login');
});
it.each(['server', 'transport'])(
  'preserves exact uncertain recovery after %s logout failure and offers retry',
  async (failure) => {
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
    expect(sessionStorage.getItem('inventory-assign-batch-v1:old')).toBe(
      'settled checklist and PRIVATE ticket',
    );
    expect(sessionStorage.getItem('inventory-assign-v1:old')).toBe(
      'exact original command',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    vi.mocked(signOutSession).mockResolvedValue({ ok: true });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
    );
    await waitFor(() =>
      expect(sessionStorage.getItem('inventory-assign-v1:old')).toBeNull(),
    );
    expect(sessionStorage.getItem('inventory-assign-batch-v1:old')).toBeNull();
  },
);
