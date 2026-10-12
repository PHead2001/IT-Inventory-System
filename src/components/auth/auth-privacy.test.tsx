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
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentProps,
} from 'react';
import {
  PrivateRestorationGate,
  PrivacyReadinessContext,
} from './privacy-readiness';
import { PrivateDocumentTitle } from './private-document-title';
import {
  revokePrivatePresentation,
  invalidateAssignmentPrivacy,
  invalidateAssignmentCallbacks,
  assignmentEpoch,
} from '@/features/scan/assign-batch';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
import type { LogoutPrivacyGeneration } from '@/lib/auth/privacy-barrier';
import { HistoryList } from '@/features/inventory/components/read-ui';
const protectedBinding = {
  actorId: 'original-actor',
  backend: 'https://isolated.supabase.co',
  role: 'staff',
  canManageConfiguration: true,
};
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
  readProtectedPrivacyIdentity: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(routing.query),
  usePathname: () => routing.pathname,
  useRouter: () => routing,
}));
vi.mock('@/lib/auth/actions', () => actions);
vi.mock('@/lib/auth/privacy-read-transport', () => actions);
vi.mock('@/lib/auth/logout-transport', () => actions);
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
}: Omit<ComponentProps<typeof ProtectedPrivacyBoundary>, 'binding'> & {
  binding?: typeof protectedBinding;
}) {
  return (
    <ProtectedPrivacyBoundary binding={protectedBinding} {...props}>
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
  actions.readProtectedPrivacyIdentity.mockResolvedValue({
    status: 'match',
    generation: { status: 'absent' },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.head
    .querySelectorAll('[data-title-regression]')
    .forEach((node) => node.remove());
});
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
    fireEvent.click(screen.getByRole('button', { name: 'Finish signing out' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Finish signing out' }));
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
    <ProtectedPrivacyBoundary binding={protectedBinding}>
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
  expect(field).toBeVisible();
  expect(field.closest('[inert]')).toBeNull();
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
    if (change === 'server generation')
      expect(screen.getByText('Accepted form')).not.toBeVisible();
    else expect(screen.getByText('Accepted form')).toBeVisible();
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
  expect(field).toBeVisible();
  expect(field.closest('[inert]')).toBeNull();
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

it('keeps accepted focus and selection during held query verification while blocking incoming bootstrap', async () => {
  routing.pathname = '/inventory/assets/new';
  const view = render(
    <ProtectedTestBoundary>
      <input aria-label="Accepted creation field" defaultValue="typed value" />
    </ProtectedTestBoundary>,
  );
  const field = (await screen.findByLabelText(
    'Accepted creation field',
  )) as HTMLInputElement;
  field.focus();
  field.setSelectionRange(2, 5);
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const reads = vi.fn();
  function IncomingPrivateOwner() {
    reads();
    return <p>New private owner</p>;
  }
  routing.query = 'draft=canonical';
  view.rerender(
    <ProtectedTestBoundary>
      <input aria-label="Accepted creation field" defaultValue="typed value" />
      <IncomingPrivateOwner />
    </ProtectedTestBoundary>,
  );
  expect(field).toBeVisible();
  expect(field.closest('[inert]')).toBeNull();
  expect(field).toHaveFocus();
  expect(field.selectionStart).toBe(2);
  expect(field.selectionEnd).toBe(5);
  expect(reads).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'absent' }));
  expect(await screen.findByText('New private owner')).toBeVisible();
  expect(screen.getByLabelText('Accepted creation field')).toBe(field);
  expect(field).toHaveFocus();
});

it('masks accepted private owners before a known logout cleanup fails', async () => {
  render(
    <ProtectedTestBoundary>
      <input
        aria-label="Retained uncertain owner"
        defaultValue="original request"
      />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Retained uncertain owner');
  seed();
  const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key,
  ) {
    if (key === recovery) throw new Error('storage blocked');
    remove.call(this, key);
  });
  act(() => {
    expect(invalidateAssignmentPrivacy(true)).toBe(false);
  });
  expect(field).not.toBeVisible();
  expect(field.closest('[inert]')).not.toBeNull();
  expect(field).toHaveValue('original request');
});

it('settles failed cleanup without retrying its own callback invalidation and retains the owner for explicit retry', async () => {
  render(
    <ProtectedTestBoundary>
      <input
        aria-label="Cleanup retry owner"
        defaultValue="uncertain original"
      />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Cleanup retry owner');
  expect(actions.readLogoutPrivacyGeneration).toHaveBeenCalledOnce();
  seed();
  const remove = Storage.prototype.removeItem;
  const blocked = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === recovery) throw new Error('storage blocked');
      remove.call(this, key);
    });
  // Bound a failing implementation: one verification may settle, but any
  // erroneous automatic retry waits rather than recursively consuming memory.
  actions.readLogoutPrivacyGeneration
    .mockResolvedValueOnce({ status: 'absent' })
    .mockReturnValue(new Promise(() => {}));
  await act(async () => {
    expect(invalidateAssignmentPrivacy(true)).toBe(false);
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  });
  expect(actions.readLogoutPrivacyGeneration).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('alert')).toHaveTextContent('could not clear');
  expect(field).not.toBeVisible();
  expect(field.closest('[inert]')).not.toBeNull();
  expect(field).toHaveValue('uncertain original');
  expect(sessionStorage.getItem(recovery)).toBe(
    'exact uncertain command and receipt',
  );

  blocked.mockRestore();
  actions.readLogoutPrivacyGeneration.mockResolvedValue({ status: 'absent' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  await waitFor(() => expect(field).toBeVisible());
  expect(screen.getByLabelText('Cleanup retry owner')).toBe(field);
  expect(field).toHaveValue('uncertain original');
  expect(sessionStorage.getItem(recovery)).toBeNull();
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
    protectedBinding,
  );
});

it('cannot use a late pre-revocation success or another actor to release the original owner', async () => {
  render(
    <ProtectedTestBoundary>
      <input
        aria-label="Original retained owner"
        defaultValue="memory-only request"
      />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Original retained owner');
  let oldRead!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      oldRead = resolve;
    }),
  );
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(field).toBeVisible();
  let identity!: (value: { status: 'denied' }) => void;
  actions.readProtectedPrivacyIdentity.mockReturnValueOnce(
    new Promise((resolve) => {
      identity = resolve;
    }),
  );
  act(() => {
    invalidateAssignmentPrivacy(false);
  });
  expect(field).not.toBeVisible();
  await waitFor(() =>
    expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
      protectedBinding,
    ),
  );
  await act(async () => oldRead({ status: 'absent' }));
  expect(field).not.toBeVisible();
  await act(async () => identity({ status: 'denied' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'original account access',
  );
  expect(field).toHaveValue('memory-only request');
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  await waitFor(() => expect(field).toBeVisible());
  expect(screen.getByLabelText('Original retained owner')).toBe(field);
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenLastCalledWith(
    protectedBinding,
  );
});

it('never retargets accepted opaque children to a different server binding', async () => {
  const view = render(
    <ProtectedTestBoundary>
      <input
        aria-label="Original binding field"
        defaultValue="private original"
      />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Original binding field');
  const bootstrap = vi.fn();
  function OtherActorConsumer() {
    bootstrap();
    return <p>Other actor route</p>;
  }
  actions.readProtectedPrivacyIdentity.mockResolvedValue({ status: 'denied' });
  view.rerender(
    <ProtectedTestBoundary
      binding={{ ...protectedBinding, actorId: 'other-actor' }}
    >
      <OtherActorConsumer />
    </ProtectedTestBoundary>,
  );
  expect(field).not.toBeVisible();
  expect(field.closest('[inert]')).not.toBeNull();
  await screen.findByRole('alert');
  expect(bootstrap).not.toHaveBeenCalled();
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
    protectedBinding,
  );
  expect(field).toHaveValue('private original');
});

it('keeps the original owner masked but admits a separate fresh server-verified owner for another actor', async () => {
  const original = render(
    <>
      <div id="__next-route-announcer__" role="alert">
        Inventory
      </div>
      <ProtectedTestBoundary>
        <input
          aria-label="Original uncertain request"
          defaultValue="original payload"
        />
      </ProtectedTestBoundary>
    </>,
  );
  const originalField = await screen.findByLabelText(
    'Original uncertain request',
  );
  actions.readProtectedPrivacyIdentity.mockResolvedValue({ status: 'denied' });
  act(() => {
    invalidateAssignmentPrivacy(false);
  });
  expect(originalField).not.toBeVisible();
  expect(originalField.closest('[inert]')).not.toBeNull();
  const warning = await screen.findByText(
    /^This workspace’s original account access/,
  );
  expect(warning).toHaveAttribute('role', 'alert');
  expect(warning).toBeVisible();
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText('Inventory')).toBeVisible();
  expect(originalField).toHaveValue('original payload');
  const recoveryLink = screen.getByRole('link', {
    name: 'open Inventory in a new tab',
  });
  expect(recoveryLink).toHaveAttribute('href', '/inventory');
  expect(recoveryLink).toHaveAttribute('target', '_blank');

  // A new document has its own server-authorized binding and owner. It must not
  // inherit the old page's terminal denial or uncertain input values.
  original.unmount();
  const bootstrap = vi.fn();
  function FreshOwner() {
    bootstrap();
    return <input aria-label="Fresh actor field" defaultValue="" />;
  }
  render(
    <ProtectedTestBoundary
      binding={{ ...protectedBinding, actorId: 'other-actor' }}
    >
      <FreshOwner />
    </ProtectedTestBoundary>,
  );
  const freshField = await screen.findByLabelText('Fresh actor field');
  expect(freshField).toBeVisible();
  expect(freshField.closest('[inert]')).toBeNull();
  expect(freshField).toHaveValue('');
  expect(bootstrap).toHaveBeenCalled();
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
    protectedBinding,
  );
  expect(actions.readProtectedPrivacyIdentity).not.toHaveBeenCalledWith({
    ...protectedBinding,
    actorId: 'other-actor',
  });
});

it('ignores an old identity success after another revocation while preserving the original action owner', async () => {
  render(
    <ProtectedTestBoundary>
      <input aria-label="Revoked owner" defaultValue="same request" />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Revoked owner');
  let oldIdentity!: (value: {
    status: 'match';
    generation: { status: 'absent' };
  }) => void;
  actions.readProtectedPrivacyIdentity
    .mockReturnValueOnce(
      new Promise((resolve) => {
        oldIdentity = resolve;
      }),
    )
    .mockResolvedValue({ status: 'denied' });
  act(() => {
    invalidateAssignmentPrivacy(false);
  });
  await waitFor(() =>
    expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledOnce(),
  );
  act(() => {
    invalidateAssignmentPrivacy(false);
  });
  await waitFor(() =>
    expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledTimes(2),
  );
  await act(async () =>
    oldIdentity({ status: 'match', generation: { status: 'absent' } }),
  );
  expect(field).not.toBeVisible();
  expect(field).toHaveValue('same request');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'original account access',
  );
});

it('allows the mounted ordinary logout action owner to complete navigation after revocation masks its shell', async () => {
  actions.signOutSession.mockResolvedValue({ ok: true, ...receipt });
  actions.readProtectedPrivacyIdentity.mockResolvedValue({ status: 'denied' });
  render(
    <ProtectedTestBoundary>
      <QueueLogoutForm />
    </ProtectedTestBoundary>,
  );
  const button = await screen.findByRole('button', { name: 'Sign out' });
  fireEvent.submit(button.closest('form')!);
  await waitFor(() => expect(routing.replace).toHaveBeenCalledWith('/login'));
  expect(actions.signOutSession).toHaveBeenCalledOnce();
});

it('a pre-receipt privacy alert does not prove logout or authorize private recovery cleanup', async () => {
  let complete!: (value: { ok: true; logoutGeneration: string }) => void;
  actions.signOutSession.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  render(
    <ProtectedPrivacyBoundary binding={protectedBinding}>
      <QueueLogoutForm />
    </ProtectedPrivacyBoundary>,
  );
  const button = await screen.findByRole('button', { name: 'Sign out' });
  seed();
  const get = Storage.prototype.getItem;
  const blocked = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(function (this: Storage, key) {
      if (
        key === 'inventory-assign-cleanup-v1' ||
        key === 'inventory-assign-scope-v1'
      )
        throw new Error('blocked');
      return get.call(this, key);
    });
  fireEvent.submit(button.closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'cannot be verified',
  );
  expect(actions.signOutSession).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(recovery)).toBe(
    'exact uncertain command and receipt',
  );
  expect(routing.replace).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Finish signing out' }),
  ).not.toBeInTheDocument();
  await act(async () => complete({ ok: true, ...receipt }));
  expect(
    await screen.findByRole('button', { name: 'Finish signing out' }),
  ).toBeVisible();
  expect(sessionStorage.getItem(recovery)).toBe(
    'exact uncertain command and receipt',
  );
  blocked.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Finish signing out' }));
  await waitFor(() => expect(routing.replace).toHaveBeenCalledWith('/login'));
  expect(sessionStorage.getItem(recovery)).toBeNull();
  expect(actions.signOutSession).toHaveBeenCalledOnce();
});

it('keeps confirmed logout cleanup retry accessible outside masked private header content', async () => {
  actions.signOutSession.mockResolvedValue({ ok: true, ...receipt });
  actions.readProtectedPrivacyIdentity.mockResolvedValue({ status: 'denied' });
  render(
    <ProtectedPrivacyBoundary binding={protectedBinding}>
      <header>
        <ProtectedPrivacyContent>
          <p>Private account identity</p>
        </ProtectedPrivacyContent>
        <section aria-label="Logout action owner">
          <QueueLogoutForm />
        </section>
      </header>
      <ProtectedPrivacyContent>
        <input aria-label="Private draft" defaultValue="keep owner" />
      </ProtectedPrivacyContent>
    </ProtectedPrivacyBoundary>,
  );
  const button = await screen.findByRole('button', { name: 'Sign out' });
  seed();
  const remove = Storage.prototype.removeItem;
  const blocked = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      if (key === recovery) throw new Error('storage blocked');
      remove.call(this, key);
    });
  fireEvent.submit(button.closest('form')!);
  const retry = await screen.findByRole('button', {
    name: 'Finish signing out',
  });
  expect(retry).toBeVisible();
  expect(retry.closest('[inert]')).toBeNull();
  expect(screen.getByText('Private account identity')).not.toBeVisible();
  expect(screen.getByLabelText('Private draft')).not.toBeVisible();
  expect(routing.replace).not.toHaveBeenCalled();
  blocked.mockRestore();
  fireEvent.click(retry);
  await waitFor(() => expect(routing.replace).toHaveBeenCalledWith('/login'));
  expect(actions.signOutSession).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(recovery)).toBeNull();
});

it('preserves a draft through transient privacy uncertainty and rechecks its original binding before readmission', async () => {
  render(
    <ProtectedTestBoundary>
      <input
        aria-label="Uncertain verification draft"
        defaultValue="typed work"
      />
    </ProtectedTestBoundary>,
  );
  const field = await screen.findByLabelText('Uncertain verification draft');
  actions.readLogoutPrivacyGeneration.mockRejectedValueOnce(
    new Error('connection unavailable'),
  );
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not clear');
  expect(field).not.toBeVisible();
  expect(field).toHaveValue('typed work');
  actions.readProtectedPrivacyIdentity.mockResolvedValueOnce({
    status: 'match',
    generation: { status: 'absent' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  await waitFor(() => expect(field).toBeVisible());
  expect(screen.getByLabelText('Uncertain verification draft')).toBe(field);
  expect(field).toHaveValue('typed work');
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
    protectedBinding,
  );
});

it('rejects a stale initial acknowledgement after fresh admission instead of revoking its accepted field', async () => {
  let oldAcknowledgement!: (value: { status: 'match' }) => void;
  actions.readLogoutPrivacyGeneration.mockResolvedValueOnce({
    status: 'valid',
    generation,
  });
  actions.acknowledgeLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      oldAcknowledgement = resolve;
    }),
  );
  render(
    <ProtectedTestBoundary>
      <input aria-label="Freshly admitted field" defaultValue="fresh value" />
    </ProtectedTestBoundary>,
  );
  await waitFor(() =>
    expect(actions.acknowledgeLogoutPrivacyGeneration).toHaveBeenCalledOnce(),
  );
  expect(
    screen.queryByLabelText('Freshly admitted field'),
  ).not.toBeInTheDocument();
  act(() => {
    invalidateAssignmentPrivacy(false);
  });
  const field = await screen.findByLabelText('Freshly admitted field');
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
    protectedBinding,
  );
  field.focus();
  await act(async () => oldAcknowledgement({ status: 'match' }));
  expect(field).toBeVisible();
  expect(field.closest('[inert]')).toBeNull();
  expect(field).toHaveFocus();
  expect(screen.getByLabelText('Freshly admitted field')).toBe(field);
});

it('does not admit initial opaque consumers after an external revocation denies the original binding', async () => {
  let staleInitialRead!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      staleInitialRead = resolve;
    }),
  );
  actions.readProtectedPrivacyIdentity.mockResolvedValue({ status: 'denied' });
  const reads = vi.fn();
  function InitialPrivateConsumer() {
    reads();
    return <p>Initial private content</p>;
  }
  render(
    <ProtectedTestBoundary>
      <InitialPrivateConsumer />
    </ProtectedTestBoundary>,
  );
  await waitFor(() =>
    expect(actions.readLogoutPrivacyGeneration).toHaveBeenCalledOnce(),
  );
  act(() => {
    invalidateAssignmentPrivacy(false);
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'original account access',
  );
  await act(async () => staleInitialRead({ status: 'absent' }));
  expect(reads).not.toHaveBeenCalled();
  expect(screen.queryByText('Initial private content')).not.toBeInTheDocument();
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledWith(
    protectedBinding,
  );
});

it('distinguishes an outgoing history disclosure from its incoming page during held route admission', async () => {
  const location = {
    id: 'shelf',
    code: 'ITC-S1A',
    name: '1A',
    breadcrumb: 'IT Closet / Shelf 1 / 1A',
    active: true,
    can_hold_inventory: true,
    parentId: null,
  };
  const event = {
    id: 'archive',
    kind: 'quantity' as const,
    entityId: 'item',
    entityName: 'Adapters',
    eventType: 'archived',
    at: '2026-10-10T12:00:00Z',
    actorName: 'Staff',
    reason: 'Removed obsolete item',
    assignment: null,
    lines: [{ location, delta: -12, before: 12, after: 0 }],
    fromLocation: null,
    toLocation: null,
    metadataChanges: [],
    customMetadataPresent: false,
    customMetadataChanged: false,
  };
  routing.pathname = '/inventory/quantity/item';
  const view = render(
    <ProtectedTestBoundary>
      <article>
        <h1>Quantity item details</h1>
        <HistoryList compact events={[event]} />
      </article>
    </ProtectedTestBoundary>,
  );
  await screen.findByRole('heading', { name: 'Quantity item details' });
  const oldDisclosure = screen.getByText('View event details');
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  routing.pathname = '/history';
  view.rerender(
    <ProtectedTestBoundary>
      <section>
        <h1>Inventory history</h1>
        <form aria-label="Filter history" />
        <HistoryList compact events={[event]} />
      </section>
    </ProtectedTestBoundary>,
  );
  expect(
    screen.queryByRole('heading', { name: 'Inventory history' }),
  ).not.toBeInTheDocument();
  expect(oldDisclosure).toBeVisible();
  fireEvent.click(oldDisclosure);
  expect(screen.getByText('Removed 12 units across 1 location.')).toBeVisible();
  await act(async () => finish({ status: 'absent' }));
  expect(
    await screen.findByRole('heading', { name: 'Inventory history' }),
  ).toBeVisible();
  expect(screen.getByRole('form', { name: 'Filter history' })).toBeVisible();
  expect(oldDisclosure).not.toBeInTheDocument();
  expect(
    screen.getByText('Removed 12 units across 1 location.'),
  ).not.toBeVisible();
  fireEvent.click(screen.getByText('View event details'));
  expect(screen.getByText('Removed 12 units across 1 location.')).toBeVisible();
});

function NamedRetainedTask() {
  const [command] = useState(() => crypto.randomUUID());
  return (
    <>
      <PrivateDocumentTitle
        routePath="/inventory/quantity/owned"
        title="Private quantity · IT Inventory"
      />
      <form data-command={command} aria-label="Retained task">
        <input aria-label="Draft" defaultValue="original" />
        <button disabled>Outcome unknown</button>
      </form>
    </>
  );
}
function namedBoundary(binding = protectedBinding) {
  return (
    <ProtectedTestBoundary binding={binding}>
      <NamedRetainedTask />
    </ProtectedTestBoundary>
  );
}
it('synchronously clears revoked names, restores only fresh same-owner titles, and retains draft and command identity', async () => {
  routing.pathname = '/inventory/quantity/owned';
  render(namedBoundary());
  const input = await screen.findByLabelText('Draft');
  const form = screen.getByRole('form', { name: 'Retained task' });
  const command = form.dataset.command;
  fireEvent.change(input, { target: { value: 'unsaved draft' } });
  await waitFor(() =>
    expect(document.title).toBe('Private quantity · IT Inventory'),
  );
  const retainedTitles = Array.from({ length: 2 }, () => {
    const node = document.createElement('title');
    node.dataset.titleRegression = 'retained';
    node.textContent = 'Private quantity · IT Inventory';
    document.head.append(node);
    return node;
  });
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    revokePrivatePresentation();
    expect(document.title).toBe('IT Inventory');
    expect(
      [...document.head.querySelectorAll('title')].map(
        (node) => node.textContent,
      ),
    ).toEqual(Array.from({ length: 3 }, () => 'IT Inventory'));
    expect(retainedTitles.every((node) => node.isConnected)).toBe(true);
  });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(input).not.toBeVisible();
  expect(form).toHaveAttribute('data-command', command);
  await act(async () => finish({ status: 'absent' }));
  await waitFor(() =>
    expect(document.title).toBe('Private quantity · IT Inventory'),
  );
  await waitFor(() =>
    expect(
      [...document.head.querySelectorAll('title')].map(
        (node) => node.textContent,
      ),
    ).toEqual(
      Array.from({ length: 3 }, () => 'Private quantity · IT Inventory'),
    ),
  );
  expect(screen.getByLabelText('Draft')).toBe(input);
  expect(input).toHaveValue('unsaved draft');
  expect(screen.getByRole('form', { name: 'Retained task' })).toBe(form);
  expect(
    screen.getByRole('button', { name: 'Outcome unknown' }),
  ).toBeDisabled();
});
it('retains the visible accepted title during a benign check, clears failure, and repairs delayed generic metadata only after recovery', async () => {
  routing.pathname = '/inventory/quantity/owned';
  render(namedBoundary());
  await screen.findByLabelText('Draft');
  await waitFor(() =>
    expect(document.title).toBe('Private quantity · IT Inventory'),
  );
  let reject!: (error: Error) => void;
  actions.readLogoutPrivacyGeneration.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  fireEvent.focus(window);
  await waitFor(() => expect(reject).toBeTypeOf('function'));
  expect(screen.getByLabelText('Draft')).toBeVisible();
  expect(document.title).toBe('Private quantity · IT Inventory');
  await act(async () => reject(new Error('Failed verification')));
  expect(document.title).toBe('IT Inventory');
  document.title = 'Quantity item · IT Inventory';
  await waitFor(() => expect(document.title).toBe('IT Inventory'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry privacy cleanup' }),
  );
  await waitFor(() =>
    expect(document.title).toBe('Private quantity · IT Inventory'),
  );
  document.title = 'Quantity item · IT Inventory';
  await waitFor(() =>
    expect(document.title).toBe('Private quantity · IT Inventory'),
  );
});
it('does not allow retained route slots or a different owner to restore a title', async () => {
  routing.pathname = '/inventory/quantity/owned';
  const view = render(namedBoundary());
  await screen.findByLabelText('Draft');
  routing.pathname = '/inventory/assets/other';
  view.rerender(namedBoundary());
  await waitFor(() => expect(document.title).toBe('IT Inventory'));
  document.title = 'Asset · IT Inventory';
  await waitFor(() => expect(document.title).toBe('IT Inventory'));
  routing.pathname = '/inventory/quantity/owned';
  actions.readProtectedPrivacyIdentity.mockResolvedValue({ status: 'denied' });
  view.rerender(
    namedBoundary({ ...protectedBinding, actorId: 'different-actor' }),
  );
  await screen.findByRole('alert');
  expect(document.title).toBe('IT Inventory');
  expect(screen.queryByLabelText('Draft')).not.toBeVisible();
});

it('never exposes the registered name before the initial private check completes', async () => {
  routing.pathname = '/inventory/quantity/owned';
  document.title = 'Stale private name';
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(namedBoundary());
  expect(document.title).toBe('IT Inventory');
  expect(screen.queryByLabelText('Draft')).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish({ status: 'absent' }));
  await waitFor(() =>
    expect(document.title).toBe('Private quantity · IT Inventory'),
  );
});
it('does not take ownership of safe public Auth metadata', async () => {
  document.title = 'Sign in · IT Inventory';
  render(
    <AuthPrivacyBoundary>
      <button>Sign in</button>
    </AuthPrivacyBoundary>,
  );
  await screen.findByRole('button', { name: 'Sign in' });
  expect(document.title).toBe('Sign in · IT Inventory');
});

it('restores preexisting Inventory and Add quantity titles only after current navigation verification without remounting its draft', async () => {
  routing.pathname = '/inventory';
  document.title = 'Inventory · IT Inventory';
  let finish!: (value: { status: 'absent' }) => void;
  actions.readLogoutPrivacyGeneration.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const ordinary = () => (
    <ProtectedTestBoundary>
      <form aria-label="Ordinary draft">
        <input aria-label="Ordinary name" defaultValue="draft" />
      </form>
    </ProtectedTestBoundary>
  );
  const view = render(ordinary());
  expect(document.title).toBe('IT Inventory');
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => finish({ status: 'absent' }));
  const input = await screen.findByLabelText('Ordinary name');
  fireEvent.change(input, { target: { value: 'unchanged unsaved name' } });
  expect(document.title).toBe('Inventory · IT Inventory');
  actions.readLogoutPrivacyGeneration.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  routing.pathname = '/inventory/quantity/new';
  view.rerender(ordinary());
  expect(document.title).toBe('IT Inventory');
  await act(async () => {
    await Promise.resolve();
  });
  document.title = 'Old private metadata';
  await waitFor(() => expect(document.title).toBe('IT Inventory'));
  await act(async () => finish({ status: 'absent' }));
  await waitFor(() =>
    expect(document.title).toBe('Add quantity item · IT Inventory'),
  );
  expect(screen.getByLabelText('Ordinary name')).toBe(input);
  expect(input).toHaveValue('unchanged unsaved name');
});

let ticketPrivacy: React.ContextType<typeof PrivacyReadinessContext>;
function TicketProbe() {
  const value = useContext(PrivacyReadinessContext);
  useLayoutEffect(() => {
    ticketPrivacy = value;
  });
  return null;
}
function ticketTree(
  overrides: Partial<ComponentProps<typeof ProtectedPrivacyBoundary>> = {},
) {
  return (
    <ProtectedPrivacyBoundary
      binding={protectedBinding}
      serverGeneration={{ status: 'absent' }}
      {...overrides}
    >
      <TicketProbe />
      <ProtectedPrivacyContent routeKey="/inventory">
        <input aria-label="Original ticket draft" />
      </ProtectedPrivacyContent>
    </ProtectedPrivacyBoundary>
  );
}
async function startTicket() {
  routing.pathname = '/inventory';
  const view = render(ticketTree());
  await screen.findByLabelText('Original ticket draft');
  await waitFor(() => expect(ticketPrivacy.ready).toBe(true));
  let settle!: (value: LogoutPrivacyGeneration) => void;
  const read = new Promise<LogoutPrivacyGeneration>((resolve) => {
    settle = resolve;
  });
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(read);
  const provider = Symbol();
  act(() => ticketPrivacy.navigation!.bind(provider));
  act(() =>
    ticketPrivacy.navigation!.prepare(
      '/inventory?search=raw&search=duplicate',
      provider,
    ),
  );
  const wait = ticketPrivacy.navigation!.admission(
    '/inventory?search=raw&search=duplicate',
  ).wait!;
  expect(wait).toBeDefined();
  return {
    view,
    provider,
    wait,
    read,
    resolve: settle,
    settle: async (value: LogoutPrivacyGeneration = { status: 'absent' }) => {
      await act(async () => {
        settle(value);
        await read;
      });
    },
  };
}
it('prepares independently of pathname commit and only admits the full raw target with its verified callback epoch', async () => {
  const operation = await startTicket();
  expect(routing.query).toBe('');
  expect(ticketPrivacy.ready).toBe(false);
  expect(ticketPrivacy.visible).toBe(true);
  expect(
    ticketPrivacy.navigation!.admission('/inventory?search=raw').wait,
  ).toBeUndefined();
  expect(ticketPrivacy.navigation!.admission('/history').ready).toBe(false);
  await operation.settle();
  await operation.wait;
  const grant = ticketPrivacy.navigation!.admission(
    '/inventory?search=raw&search=duplicate',
  );
  expect(grant.ready).toBe(true);
  expect(grant.verifiedEpoch).toBe(assignmentEpoch());
  expect(
    ticketPrivacy.navigation!.admission(
      '/inventory?search=duplicate&search=raw',
    ).ready,
  ).toBe(false);
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenLastCalledWith(
    protectedBinding,
  );
});
it.each([
  'actor',
  'backend',
  'role',
  'configuration',
  'server-generation',
  'revision',
  'revocation',
  'callbacks',
  'hidden',
  'cancel',
  'supersede',
  'dispose',
  'provider',
  'redirect',
] as const)(
  'retires and settles a precommit ticket on %s without admitting its late result',
  async (change) => {
    const operation = await startTicket();
    if (change === 'dispose') operation.view.unmount();
    else
      act(() => {
        if (change === 'actor')
          operation.view.rerender(
            ticketTree({
              binding: { ...protectedBinding, actorId: 'replacement' },
            }),
          );
        if (change === 'backend')
          operation.view.rerender(
            ticketTree({
              binding: {
                ...protectedBinding,
                backend: 'https://other.example',
              },
            }),
          );
        if (change === 'role')
          operation.view.rerender(
            ticketTree({ binding: { ...protectedBinding, role: 'viewer' } }),
          );
        if (change === 'configuration')
          operation.view.rerender(
            ticketTree({
              binding: { ...protectedBinding, canManageConfiguration: false },
            }),
          );
        if (change === 'server-generation')
          operation.view.rerender(
            ticketTree({ serverGeneration: { status: 'valid', generation } }),
          );
        if (change === 'revision')
          operation.view.rerender(ticketTree({ revision: 1 }));
        if (change === 'revocation') revokePrivatePresentation();
        if (change === 'callbacks') invalidateAssignmentCallbacks();
        if (change === 'hidden') {
          vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
            'hidden',
          );
          document.dispatchEvent(new Event('visibilitychange'));
        }
        if (change === 'provider') ticketPrivacy.navigation!.bind(Symbol());
        if (change === 'cancel')
          ticketPrivacy.navigation!.retire(operation.provider);
        if (change === 'supersede')
          ticketPrivacy.navigation!.prepare('/history', operation.provider);
        if (change === 'redirect') {
          routing.pathname = '/history';
          operation.view.rerender(ticketTree());
        }
      });
    await operation.wait;
    await operation.settle();
    if (change === 'dispose') {
      expect(screen.queryByLabelText('Original ticket draft')).toBeNull();
      return;
    }
    expect(
      ticketPrivacy.navigation!.admission(
        '/inventory?search=raw&search=duplicate',
      ).ready,
    ).toBe(false);
    expect(
      ticketPrivacy.navigation!.admission(
        '/inventory?search=raw&search=duplicate',
      ).wait,
    ).toBeUndefined();
  },
);
it.each(['denied', 'unavailable'] as const)(
  'settles a failed %s original identity without private bootstrap',
  async (status) => {
    const operation = await startTicket();
    actions.readProtectedPrivacyIdentity.mockResolvedValueOnce({ status });
    await operation.settle();
    await operation.wait;
    expect(
      ticketPrivacy.navigation!.admission(
        '/inventory?search=raw&search=duplicate',
      ).ready,
    ).toBe(false);
    expect(actions.readProtectedPrivacyIdentity).toHaveBeenCalledOnce();
    // Accepted draft ownership survives failure; its presentation is masked.
    expect(screen.getByLabelText('Original ticket draft')).not.toBeVisible();
    expect(
      screen.getByLabelText('Original ticket draft').closest('[hidden][inert]'),
    ).not.toBeNull();
  },
);

it.each(['revision', 'redirect'] as const)(
  'rejects a completed target ticket in the first %s render before private effects mount',
  async (change) => {
    const operation = await startTicket();
    await operation.settle();
    await operation.wait;
    expect(
      ticketPrivacy.navigation!.admission(
        '/inventory?search=raw&search=duplicate',
      ).ready,
    ).toBe(true);
    const bootstrap = vi.fn();
    function PrivateBootstrap() {
      useEffect(bootstrap, []);
      return <input aria-label="New target bootstrap" />;
    }
    if (change === 'redirect') routing.pathname = '/history';
    operation.view.rerender(
      <ProtectedPrivacyBoundary
        binding={protectedBinding}
        serverGeneration={{ status: 'absent' }}
        revision={change === 'revision' ? 1 : 0}
      >
        <TicketProbe />
        <ProtectedPrivacyContent routeKey="/inventory?search=raw&search=duplicate">
          <PrivateBootstrap />
        </ProtectedPrivacyContent>
      </ProtectedPrivacyBoundary>,
    );
    expect(bootstrap).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('New target bootstrap')).toBeNull();
  },
);

it('settles a target that discovers new logout evidence and resumes distinct current-route recovery without rebasing it', async () => {
  const operation = await startTicket();
  await operation.settle({ status: 'valid', generation });
  await operation.wait;
  await waitFor(() => expect(ticketPrivacy.ready).toBe(true));
  expect(
    ticketPrivacy.navigation!.admission(
      '/inventory?search=raw&search=duplicate',
    ).ready,
  ).toBe(false);
  expect(
    ticketPrivacy.navigation!.admission(
      '/inventory?search=raw&search=duplicate',
    ).wait,
  ).toBeUndefined();
  expect(actions.readProtectedPrivacyIdentity).toHaveBeenLastCalledWith(
    protectedBinding,
  );
});

it('a positive target wait settles only after coherent verified state is published', async () => {
  const operation = await startTicket();
  let accepted!: { ready: boolean; verifiedEpoch?: number };
  const beforePublication = operation.wait.then(() => {
    accepted = ticketPrivacy.navigation!.admission(
      '/inventory?search=raw&search=duplicate',
    );
  });
  await operation.settle();
  await beforePublication;
  expect(accepted.ready).toBe(true);
  expect(accepted.verifiedEpoch).toBe(assignmentEpoch());
});
it('a committed target ticket cannot suppress verification when history returns to its original source', async () => {
  const operation = await startTicket();
  await operation.settle();
  routing.query = 'search=raw&search=duplicate';
  operation.view.rerender(ticketTree());
  await waitFor(() => expect(ticketPrivacy.ready).toBe(true));
  const before = actions.readLogoutPrivacyGeneration.mock.calls.length;
  let settle!: (value: LogoutPrivacyGeneration) => void;
  const read = new Promise<LogoutPrivacyGeneration>((resolve) => {
    settle = resolve;
  });
  actions.readLogoutPrivacyGeneration.mockReturnValueOnce(read);
  routing.query = '';
  operation.view.rerender(ticketTree());
  await waitFor(() =>
    expect(
      actions.readLogoutPrivacyGeneration.mock.calls.length,
    ).toBeGreaterThan(before),
  );
  expect(ticketPrivacy.ready).toBe(false);
  expect(ticketPrivacy.navigation!.admission('/inventory').ready).toBe(false);
  expect(
    ticketPrivacy.navigation!.admission(
      '/inventory?search=raw&search=duplicate',
    ).ready,
  ).toBe(false);
  await act(async () => {
    settle({ status: 'absent' });
    await read;
  });
  await waitFor(() => expect(ticketPrivacy.ready).toBe(true));
});
it('provider cancellation settles a committed target and restarts canonical current-key verification', async () => {
  const operation = await startTicket();
  routing.query = 'search=raw&search=duplicate';
  operation.view.rerender(ticketTree());
  expect(ticketPrivacy.ready).toBe(false);
  act(() => ticketPrivacy.navigation!.retire(operation.provider));
  await operation.wait;
  await waitFor(() => expect(ticketPrivacy.ready).toBe(true));
  await operation.settle();
  expect(ticketPrivacy.ready).toBe(true);
});

it('a stale provider cannot retire a current ticket through prepare and repeated accepted preparation restores current-route readiness', async () => {
  const operation = await startTicket();
  act(() => ticketPrivacy.navigation!.prepare('/history', Symbol()));
  expect(
    ticketPrivacy.navigation!.admission(
      '/inventory?search=raw&search=duplicate',
    ).wait,
  ).toBe(operation.wait);
  act(() => ticketPrivacy.navigation!.prepare('/history', operation.provider));
  await operation.wait;
  await waitFor(() => expect(ticketPrivacy.ready).toBe(true));
  await operation.settle();
  expect(
    ticketPrivacy.navigation!.admission(
      '/inventory?search=raw&search=duplicate',
    ).ready,
  ).toBe(false);
});
it('target readiness supplies its captured epoch to transition admission and nested private restoration', async () => {
  const operation = await startTicket();
  await operation.settle();
  await operation.wait;
  let nested!: React.ContextType<typeof PrivacyReadinessContext>;
  function TargetBootstrap() {
    const privacy = useContext(PrivacyReadinessContext);
    useLayoutEffect(() => {
      nested = privacy;
    });
    return <input aria-label="Transition target restoration" />;
  }
  operation.view.rerender(
    <ProtectedPrivacyBoundary
      binding={protectedBinding}
      serverGeneration={{ status: 'absent' }}
    >
      <TicketProbe />
      <ProtectedPrivacyContent
        transitionAdmission
        routeKey="/inventory?search=raw&search=duplicate"
      >
        <TargetBootstrap />
      </ProtectedPrivacyContent>
    </ProtectedPrivacyBoundary>,
  );
  await screen.findByLabelText('Transition target restoration');
  expect(ticketPrivacy.ready).toBe(false);
  expect(nested.ready).toBe(true);
  expect(nested.verifiedEpoch).toBe(assignmentEpoch());
});
