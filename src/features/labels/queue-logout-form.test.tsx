import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { logout } from '@/lib/auth/actions';
import { QueueLogoutForm } from './queue-logout-form';
import {
  clearAllDesignerRecovery,
  readDesignerRecovery,
  writeDesignerRecovery,
} from '@/features/metadata/designer-recovery';
import { clearLabelQueueSession } from './queue-model';

vi.mock('@/lib/auth/actions', () => ({ logout: vi.fn() }));
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
  vi.mocked(logout).mockClear();
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
  expect(logout).not.toHaveBeenCalled();
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
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
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
