import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AuthPrivacyBoundary,
  PasswordLogoutCompletion,
  ProtectedPrivacyBoundary,
} from './auth-privacy';
import { ProtectedPrivacyContent } from './privacy-content';
import { AuthForm } from './auth-form';
import { useEffect, useState, type ComponentProps } from 'react';
import { PrivateRestorationGate } from './privacy-readiness';
const routing = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  pathname: '/login',
  query: '',
}));
const actions = vi.hoisted(() => ({
  login: vi.fn(),
  recover: vi.fn(),
  confirmAuth: vi.fn(),
  setPassword: vi.fn(),
  signOutSession: vi.fn(),
  readLogoutPrivacyGeneration: vi.fn(),
  acknowledgeLogoutPrivacyGeneration: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(routing.query),
  usePathname: () => routing.pathname,
  useRouter: () => routing,
}));
vi.mock('@/lib/auth/actions', () => actions);
const generation = '00000000-0000-4000-8000-000000000001';
const receipt = { logoutGeneration: generation };
const batch = 'inventory-assign-batch-v1:private';
const recovery = 'inventory-assign-v1:private';
const labels = 'it-inventory-label-queue:v1:private';
function seed() {
  sessionStorage.setItem(batch, 'PRIVATE ticket');
  sessionStorage.setItem(recovery, 'exact uncertain command and receipt');
  sessionStorage.setItem(labels, 'private queued label identifiers');
  sessionStorage.setItem('unrelated-application', 'retain');
}
function ProtectedTestBoundary({
  children,
  ...props
}: ComponentProps<typeof ProtectedPrivacyBoundary>) {
  return (
    <ProtectedPrivacyBoundary {...props}>
      <ProtectedPrivacyContent>{children}</ProtectedPrivacyContent>
    </ProtectedPrivacyBoundary>
  );
}
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  routing.pathname = '/login';
  routing.query = '';
  actions.readLogoutPrivacyGeneration.mockResolvedValue({ status: 'absent' });
  actions.acknowledgeLogoutPrivacyGeneration.mockResolvedValue({
    status: 'match',
  });
});
afterEach(() => vi.restoreAllMocks());
it('clears all acknowledged password logout namespaces before navigating without retaining password fields', async () => {
  seed();
  actions.setPassword.mockResolvedValueOnce({
    passwordUpdated: true,
    sessionClosed: true,
    logoutGeneration: generation,
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
    render(<PasswordLogoutCompletion receipt={receipt} />);
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
  const first = render(<PasswordLogoutCompletion receipt={receipt} />);
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
    logoutGeneration: string;
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
    complete({
      passwordUpdated: true,
      sessionClosed: true,
      logoutGeneration: generation,
    }),
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

it('blocks a confirmed logout reminder failure without replaying password or signout', async () => {
  render(
    <PasswordLogoutCompletion receipt={{ cleanupReminderUnavailable: true }} />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'reminder could not be saved',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  expect(routing.replace).not.toHaveBeenCalled();
  expect(actions.setPassword).not.toHaveBeenCalled();
  expect(actions.signOutSession).not.toHaveBeenCalled();
});
it('checks a fresh generation on reactivation before presenting the auth form again', async () => {
  seed();
  render(<AuthForm mode="login" />);
  await screen.findByLabelText('Email');
  actions.readLogoutPrivacyGeneration.mockResolvedValue({
    status: 'valid',
    generation,
  });
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await screen.findByLabelText('Email');
  expect(sessionStorage.getItem(recovery)).toBeNull();
  expect(actions.readLogoutPrivacyGeneration).toHaveBeenCalledTimes(2);
});
it('preserves editable auth state when a reactivation check observes the same generation', async () => {
  render(<AuthForm mode="login" />);
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'staff@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'typed password' },
  });
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(screen.getByLabelText('Email')).toHaveValue('staff@example.test');
  expect(screen.getByLabelText('Password')).toHaveValue('typed password');
});

it('renders the retained server route slot while withholding its successful private body', async () => {
  routing.pathname = '/scan';
  const slotRendered = vi.fn();
  const bootstrap = vi.fn();
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  function PrivateBody() {
    bootstrap();
    return <input aria-label="Private page field" defaultValue="typed work" />;
  }
  function RouteSlot() {
    slotRendered();
    return (
      <ProtectedPrivacyContent>
        <PrivateBody />
      </ProtectedPrivacyContent>
    );
  }
  render(
    <ProtectedPrivacyBoundary>
      <RouteSlot />
    </ProtectedPrivacyBoundary>,
  );
  expect(slotRendered).toHaveBeenCalled();
  expect(bootstrap).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'absent' }));
  const field = await screen.findByLabelText('Private page field');
  expect(field).toBeVisible();
  expect(bootstrap).toHaveBeenCalledOnce();
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(field).not.toBeVisible();
  expect(field.closest('[inert]')).not.toBeNull();
  await act(async () => finish({ status: 'absent' }));
  expect(screen.getByLabelText('Private page field')).toBe(field);
  expect(field).toHaveValue('typed work');
  expect(field).toBeVisible();
  expect(bootstrap).toHaveBeenCalledOnce();
});

it('withholds new route restoration until a fresh check in the retained protected boundary completes', async () => {
  const view = render(
    <ProtectedTestBoundary>
      <p>Existing route</p>
    </ProtectedTestBoundary>,
  );
  await screen.findByText('Existing route');
  seed();
  let finish!: (value: { status: 'valid'; generation: string }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  routing.pathname = '/scan';
  function NewPrivateConsumer() {
    return <p>{sessionStorage.getItem(recovery) ?? 'New route is clean'}</p>;
  }
  view.rerender(
    <ProtectedTestBoundary>
      <NewPrivateConsumer />
    </ProtectedTestBoundary>,
  );
  expect(
    screen.queryByText('exact uncertain command and receipt'),
  ).not.toBeInTheDocument();
  await act(async () => finish({ status: 'valid', generation }));
  expect(await screen.findByText('New route is clean')).toBeVisible();
  expect(sessionStorage.getItem(recovery)).toBeNull();
});
it('gates email confirmation outside the auth route group on the retained generation', async () => {
  seed();
  actions.readLogoutPrivacyGeneration.mockResolvedValue({
    status: 'valid',
    generation,
  });
  render(
    <AuthForm mode="confirm" tokenHash="email-token" tokenType="recovery" />,
  );
  await screen.findByRole('button', { name: 'Continue securely' });
  expect(sessionStorage.getItem(recovery)).toBeNull();
  expect(actions.confirmAuth).not.toHaveBeenCalled();
  expect(
    screen.getByRole('form').querySelector('input[name="logout_generation"]'),
  ).toHaveValue(generation);
});

it('withholds query-only navigation consumers until the deferred fresh read completes', async () => {
  routing.pathname = '/scan';
  const view = render(
    <ProtectedTestBoundary>
      <p>Scan to open</p>
    </ProtectedTestBoundary>,
  );
  await screen.findByText('Scan to open');
  seed();
  let finish!: (value: { status: 'valid'; generation: string }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  routing.query = 'mode=assign';
  const storageRead = vi.fn();
  function NewPrivateConsumer() {
    storageRead(sessionStorage.getItem(recovery));
    return <p>Assigned route released</p>;
  }
  view.rerender(
    <ProtectedTestBoundary>
      <NewPrivateConsumer />
    </ProtectedTestBoundary>,
  );
  expect(storageRead).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'valid', generation }));
  expect(await screen.findByText('Assigned route released')).toBeVisible();
  expect(storageRead).toHaveBeenCalledWith(null);
});
it.each(['server generation', 'action revision'] as const)(
  'blocks same-path incoming children for a changed %s before its deferred read completes',
  async (change) => {
    const firstServer = { status: 'valid', generation } as const;
    actions.readLogoutPrivacyGeneration.mockResolvedValue(firstServer);
    const view = render(
      <ProtectedTestBoundary serverGeneration={firstServer} revision={0}>
        <p>Accepted form</p>
      </ProtectedTestBoundary>,
    );
    await screen.findByText('Accepted form');
    seed();
    const newer = '00000000-0000-4000-8000-000000000002';
    let finish!: (value: { status: 'valid'; generation: string }) => void;
    actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const storageRead = vi.fn();
    function NewPrivateConsumer() {
      storageRead(sessionStorage.getItem(recovery));
      return <p>Verified changed entry</p>;
    }
    view.rerender(
      <ProtectedTestBoundary
        serverGeneration={
          change === 'server generation'
            ? { status: 'valid', generation: newer }
            : firstServer
        }
        revision={change === 'action revision' ? 1 : 0}
      >
        <NewPrivateConsumer />
      </ProtectedTestBoundary>,
    );
    expect(storageRead).not.toHaveBeenCalled();
    expect(screen.getByText('Accepted form')).not.toBeVisible();
    await act(async () => finish({ status: 'valid', generation: newer }));
    expect(await screen.findByText('Verified changed entry')).toBeVisible();
    expect(storageRead).toHaveBeenCalledWith(null);
  },
);
it('holds direct incoming consumers during reactivation without losing unchanged field nodes', async () => {
  const view = render(
    <ProtectedTestBoundary>
      <input aria-label="Unchanged field" defaultValue="typed work" />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Unchanged field');
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(field).not.toBeVisible();
  expect(field).toHaveValue('typed work');
  const storageRead = vi.fn();
  function NewPrivateConsumer() {
    storageRead(sessionStorage.getItem(recovery));
    return <p>New consumer</p>;
  }
  view.rerender(
    <ProtectedTestBoundary>
      <input aria-label="Unchanged field" defaultValue="typed work" />
      <NewPrivateConsumer />
    </ProtectedTestBoundary>,
  );
  expect(storageRead).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'absent' }));
  expect(await screen.findByText('New consumer')).toBeVisible();
});
it('blocks a newly mounted restoration gate inside retained internally updating children during a pending reactivation', async () => {
  let expose!: () => void;
  const storageRead = vi.fn();
  function StorageConsumer() {
    storageRead(sessionStorage.getItem(recovery));
    return <p>Internally mounted private consumer</p>;
  }
  function InternalRouter() {
    const [show, setShow] = useState(false);
    useEffect(() => {
      expose = () => setShow(true);
    }, []);
    return (
      <>
        <input aria-label="Retained field" defaultValue="pending values" />
        {show && (
          <PrivateRestorationGate scope="synthetic actor">
            <StorageConsumer />
          </PrivateRestorationGate>
        )}
      </>
    );
  }
  render(
    <ProtectedTestBoundary>
      <InternalRouter />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Retained field');
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    expose();
  });
  expect(storageRead).not.toHaveBeenCalled();
  expect(field).toHaveValue('pending values');
  await act(async () => finish({ status: 'absent' }));
  expect(
    await screen.findByText('Internally mounted private consumer'),
  ).toBeVisible();
  expect(screen.getByLabelText('Retained field')).toBe(field);
  expect(screen.getByLabelText('Retained field')).toHaveValue('pending values');
});
