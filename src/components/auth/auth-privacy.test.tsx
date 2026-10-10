import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthPrivacyBoundary, PasswordLogoutCompletion } from './auth-privacy';
import { AuthForm } from './auth-form';
const routing = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  login: vi.fn(),
  recover: vi.fn(),
  confirmAuth: vi.fn(),
  setPassword: vi.fn(),
  signOutSession: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => routing }));
vi.mock('@/lib/auth/actions', () => actions);
const batch = 'inventory-assign-batch-v1:private';
const recovery = 'inventory-assign-v1:private';
const labels = 'it-inventory-label-queue:v1:private';
function seed() {
  sessionStorage.setItem(batch, 'PRIVATE ticket');
  sessionStorage.setItem(recovery, 'exact uncertain command and receipt');
  sessionStorage.setItem(labels, 'private queued label identifiers');
  sessionStorage.setItem('unrelated-application', 'retain');
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());
it('clears all acknowledged password logout namespaces before navigating without retaining password fields', async () => {
  seed();
  actions.setPassword.mockResolvedValueOnce({
    passwordUpdated: true,
    sessionClosed: true,
  });
  render(<AuthForm mode="password" emailedCompletion />);
  const password = await screen.findByLabelText('Password');
  fireEvent.change(password, { target: { value: 'Replacement123456' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'Replacement123456' },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole('form', { name: 'Set password' }));
  });
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith('/login?password=updated'),
  );
  for (const key of [batch, recovery, labels])
    expect(sessionStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem('unrelated-application')).toBe('retain');
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  expect(actions.setPassword).toHaveBeenCalledOnce();
});
it.each([batch, recovery, labels])(
  'retains a strong tombstone and retries without a password mutation when removal of %s fails',
  async (key) => {
    seed();
    const remove = Storage.prototype.removeItem;
    const denied = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(function (this: Storage, target) {
        if (target === key) return; // A silent failure must be verified too.
        remove.call(this, target);
      });
    render(<PasswordLogoutCompletion />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not clear',
    );
    expect(routing.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBe('all');
    denied.mockRestore();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry privacy cleanup' }),
    );
    await waitFor(() =>
      expect(routing.replace).toHaveBeenCalledWith('/login?password=updated'),
    );
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
    expect(actions.setPassword).not.toHaveBeenCalled();
  },
);
it('blocks auth entry after failed cleanup/remount until its existing all marker can be cleared', async () => {
  seed();
  const remove = Storage.prototype.removeItem;
  const denied = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === labels) throw new Error('Denied');
      remove.call(this, key);
    });
  const first = render(<PasswordLogoutCompletion />);
  await screen.findByRole('alert');
  first.unmount();
  render(
    <AuthPrivacyBoundary>
      <button>Sign in</button>
    </AuthPrivacyBoundary>,
  );
  await screen.findByRole('alert');
  expect(
    screen.queryByRole('button', { name: 'Sign in' }),
  ).not.toBeInTheDocument();
  expect(routing.replace).not.toHaveBeenCalled();
  denied.mockRestore();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(sessionStorage.getItem(labels)).toBeNull();
});
it.each(['none', 'private', 'invalid'] as const)(
  'does not authorize uncertain recovery deletion from a forged updated URL or %s marker',
  async (marker) => {
    seed();
    window.history.replaceState(null, '', '/login?password=updated');
    if (marker !== 'none')
      sessionStorage.setItem(
        'inventory-assign-cleanup-v1',
        marker === 'private' ? 'private' : 'invalid',
      );
    render(
      <AuthPrivacyBoundary>
        <button>Sign in</button>
      </AuthPrivacyBoundary>,
    );
    if (marker === 'invalid') {
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'cannot be verified',
      );
      expect(
        screen.queryByRole('button', { name: 'Sign in' }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'Retry privacy cleanup' }),
      );
    } else await screen.findByRole('button', { name: 'Sign in' });
    expect(sessionStorage.getItem(recovery)).toBe(
      'exact uncertain command and receipt',
    );
    expect(sessionStorage.getItem(batch)).toBe('PRIVATE ticket');
    expect(sessionStorage.getItem(labels)).toBe(
      'private queued label identifiers',
    );
    expect(routing.replace).not.toHaveBeenCalled();
  },
);
it('keeps the password-updated signout retry path and exact recovery when logout is not acknowledged', async () => {
  seed();
  actions.setPassword.mockResolvedValueOnce({
    passwordUpdated: true,
    error:
      'Your password was updated, but sign-out failed. Sign out before continuing.',
  });
  render(<AuthForm mode="password" emailedCompletion />);
  const password = await screen.findByLabelText('Password');
  fireEvent.change(password, { target: { value: 'Replacement123456' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'Replacement123456' },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole('form', { name: 'Set password' }));
  });
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeEnabled();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(sessionStorage.getItem(recovery)).toBe(
    'exact uncertain command and receipt',
  );
  expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
  expect(routing.replace).not.toHaveBeenCalled();
});
it('retains the password action owner across verified-to-unavailable props while its confirmed logout is held', async () => {
  seed();
  let complete!: (value: {
    passwordUpdated: true;
    sessionClosed: true;
  }) => void;
  actions.setPassword.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(
    <AuthForm mode="password" sessionAvailable emailedCompletion />,
  );
  fireEvent.change(await screen.findByLabelText('Password'), {
    target: { value: 'Replacement123456' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'Replacement123456' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Set password' }));
  await waitFor(() => expect(actions.setPassword).toHaveBeenCalledOnce());
  view.rerender(
    <AuthForm
      mode="password"
      sessionAvailable={false}
      emailedCompletion={false}
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to verify',
  );
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(sessionStorage.getItem(recovery)).toBe(
    'exact uncertain command and receipt',
  );
  await act(async () =>
    complete({ passwordUpdated: true, sessionClosed: true }),
  );
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith('/login?password=updated'),
  );
  for (const key of [batch, recovery, labels])
    expect(sessionStorage.getItem(key)).toBeNull();
  expect(actions.setPassword).toHaveBeenCalledOnce();
});
it.each(['fresh anonymous', 'external expiry'] as const)(
  'shows recovery with no editable fields or deletion for %s without a logout acknowledgement',
  async (entry) => {
    seed();
    const view = render(
      <AuthForm
        mode="password"
        sessionAvailable={entry === 'external expiry'}
        emailedCompletion
      />,
    );
    if (entry === 'external expiry') {
      await screen.findByLabelText('Password');
      view.rerender(
        <AuthForm
          mode="password"
          sessionAvailable={false}
          emailedCompletion={false}
        />,
      );
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to verify',
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/login?switch=1',
    );
    expect(
      screen.getByRole('link', { name: 'Request a new reset email' }),
    ).toHaveAttribute('href', '/forgot-password');
    for (const key of [batch, recovery, labels])
      expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(routing.replace).not.toHaveBeenCalled();
    expect(actions.setPassword).not.toHaveBeenCalled();
  },
);
it('fails closed without deleting anything when auth-entry cleanup markers cannot be read', async () => {
  seed();
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const get = Storage.prototype.getItem;
  const denied = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === 'inventory-assign-cleanup-v1') throw new Error('Denied');
      return get.call(this, key);
    });
  render(
    <AuthPrivacyBoundary>
      <button>Sign in</button>
    </AuthPrivacyBoundary>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'cannot be verified',
  );
  expect(
    screen.queryByRole('button', { name: 'Sign in' }),
  ).not.toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
  expect(get.call(sessionStorage, recovery)).toBe(
    'exact uncertain command and receipt',
  );
  denied.mockRestore();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(sessionStorage.getItem(recovery)).toBe(
    'exact uncertain command and receipt',
  );
});
