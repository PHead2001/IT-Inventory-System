import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: '/inventory',
}));
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  listener: null as
    ((event: string, session: { user: { id: string } } | null) => void) | null,
  callbacks: [] as Array<
    (event: string, session: { user: { id: string } } | null) => void
  >,
  unsubscribe: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUser: auth.getUser,
      onAuthStateChange: (listener: typeof auth.listener) => {
        auth.callbacks.push(listener!);
        auth.listener = (event, session) =>
          auth.callbacks.forEach((callback) => callback(event, session));
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  }),
}));
vi.mock('@/features/custody/actions', () => ({ submitCustody: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => true,
}));
import {
  CommandButtons,
  CommandProvider,
  ShortcutPreference,
  ShortcutBadge,
} from './command-provider';
import { type ReactNode } from 'react';
import { RouteMotionProvider } from '@/components/experience/route-motion';
import { RouteReady } from '@/components/experience/route-ready';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import { TaskWorkspace } from '@/features/inventory/components/task-workspace';
import { SiteManagementForm } from '@/features/custody/management-form';
import { registerNavigationGuard } from '@/lib/navigation/guard';
const row = {
  kind: 'asset',
  id: 'a3010000-0000-4000-8000-000000000001',
  name: 'Camera laptop',
  code: null,
  assetTag: 'PAL-ONE',
  serialNumber: 'SERIAL',
  status: 'active',
  matchedField: 'name',
};
function response(name = 'Camera laptop', actorId = 'actor') {
  return new Response(
    JSON.stringify({
      identity: { actorId, backend: 'local-backend' },
      result: { version: 1, rows: [{ ...row, name }], hasMore: false },
    }),
  );
}
function Authority({
  children,
  fresh = true,
}: {
  children: ReactNode;
  fresh?: boolean;
}) {
  return (
    <PrivacyReadinessContext
      value={{
        ready: fresh,
        visible: true,
        generation: 'actor:local-backend',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <RouteMotionProvider actorId="actor">{children}</RouteMotionProvider>
    </PrivacyReadinessContext>
  );
}
function Workspace({
  staff = true,
  fresh = true,
}: {
  staff?: boolean;
  fresh?: boolean;
}) {
  return (
    <Authority fresh={fresh}>
      <CommandProvider actorId="actor" backend="local-backend" staff={staff}>
        <CommandButtons />
        <ShortcutPreference />
        <ShortcutBadge href="/scan" />
        <RouteReady
          actorId="actor"
          routeKey={navigation.pathname + location.search}
          contentIdentity={navigation.pathname}
        >
          <main id="main-content">
            <h1>Inventory</h1>
            <input data-inventory-search="true" aria-label="Ordinary search" />
            <button>Outside</button>
            <input aria-label="Retained draft" defaultValue="" />
          </main>
        </RouteReady>
      </CommandProvider>
    </Authority>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  navigation.pathname = '/inventory';
  window.history.replaceState({}, '', '/inventory');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  auth.callbacks = [];
  navigation.push.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  auth.listener = null;
  auth.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'actor' } }, error: null });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function settle() {
  // Commit the asynchronous getUser decision before advancing the query's
  // debounce. Verification intentionally starts the search clock afterward.
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(151);
  });
}
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Search and commands' }));
  return screen.getByRole('combobox');
}
it('focuses connected Add choices both from N and an existing palette and contains Tab/Escape', async () => {
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Search and commands' });
  launcher.focus();
  fireEvent.keyDown(window, { key: 'n' });
  expect(screen.getByRole('link', { name: 'Add quantity item' })).toHaveFocus();
  const last = screen.getByRole('link', { name: 'Add individual asset' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => {});
  expect(launcher).toHaveFocus();
  open();
  fireEvent.click(screen.getByRole('option', { name: /^Add item/ }));
  expect(screen.getByRole('link', { name: 'Add quantity item' })).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => {});
  expect(launcher).toHaveFocus();
});
it('rechecks Auth on every open and never reuses a previous opening result', async () => {
  render(<Workspace />);
  fireEvent.change(open(), { target: { value: 'camera' } });
  await settle();
  expect(screen.getByText('Camera laptop')).toBeVisible();
  fireEvent.keyDown(window, { key: 'Escape' });
  auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  fireEvent.change(open(), { target: { value: 'camera' } });
  await settle();
  expect(auth.getUser).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Camera laptop')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each([null, { user: { id: 'other' } }])(
  'invalidates displayed/inflight records on an actual cross-tab session change %j',
  async (session) => {
    let resolve: (value: Response) => void = () => {};
    let signal: AbortSignal | null = null;
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'camera' } });
    await settle();
    expect(screen.getByText('Camera laptop')).toBeVisible();
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options!.signal as AbortSignal;
      return new Promise((complete) => {
        resolve = complete;
      });
    });
    fireEvent.change(search, { target: { value: 'another' } });
    await settle();
    act(() => {
      auth.listener!('SIGNED_OUT', session);
    });
    expect(signal!.aborted).toBe(true);
    expect(screen.queryByText('Camera laptop')).toBeNull();
    await act(async () => {
      resolve(response('Old private reply'));
    });
    expect(screen.queryByText('Old private reply')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);
it('uses the actual site recovery guard for palette, shortcut, and Add-choice navigation', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://site-test.supabase.co');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unavailable');
  });
  render(
    <Authority>
      <CommandProvider actorId="actor" backend="local-backend" staff>
        <CommandButtons />
        <SiteManagementForm actorId="a3010000-0000-4000-8000-000000000099" />
      </CommandProvider>
    </Authority>,
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Retain site draft' },
  });
  open();
  fireEvent.click(screen.getByRole('option', { name: /^Scan/ }));
  expect(navigation.push).not.toHaveBeenCalled();
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Name')).toHaveValue('Retain site draft');
  expect(screen.getByRole('alert')).toHaveTextContent('Navigation is paused');
  screen.getByRole('button', { name: 'Search and commands' }).focus();
  fireEvent.keyDown(window, { key: 's' });
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'n' });
  fireEvent.click(screen.getByRole('link', { name: 'Add individual asset' }));
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Name')).toHaveValue('Retain site draft');
  await act(async () => {});
});
it('honors a declined shared leave decision without pushing or retaining the palette', async () => {
  const remove = registerNavigationGuard(() => false);
  try {
    render(<Workspace />);
    open();
    fireEvent.click(screen.getByRole('option', { name: /^Scan/ }));
    await act(async () => {});
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    remove();
  }
});
it('scrolls only the results viewport when arrows wrap/select an offscreen option', async () => {
  vi.mocked(fetch).mockImplementationOnce(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: {
            version: 1,
            rows: Array.from({ length: 20 }, (_, i) => ({
              ...row,
              id: 'a3010000-0000-4000-8000-' + String(i).padStart(12, '0'),
              name: 'Viewport equipment ' + i,
            })),
            hasMore: true,
          },
        }),
      ),
    ),
  );
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'viewport' } });
  await settle();
  const list = screen.getByRole('listbox');
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 200,
  } as DOMRect);
  const last = screen.getAllByRole('option').at(-1)!;
  vi.spyOn(last, 'getBoundingClientRect').mockReturnValue({
    top: 900,
    bottom: 950,
  } as DOMRect);
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expect(list.scrollTop).toBe(750);
  expect(search).toHaveAttribute('aria-activedescendant', last.id);
  fireEvent.keyDown(search, { key: 'Enter' });
  await act(async () => {});
  expect(navigation.push).toHaveBeenLastCalledWith(
    '/inventory/assets/' + row.id.slice(0, -12) + '000000000019',
  );
});
it('owns one accessible modal, inerts background, traps Tab, and restores Escape focus', async () => {
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Search and commands' });
  launcher.focus();
  open();
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('combobox')).toHaveFocus();
  expect(launcher.closest('[inert]')).not.toBeNull();
  const first = screen.getByRole('button', { name: 'Close dialog' });
  const last = screen.getAllByRole('option').at(-1)!;
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(launcher).toHaveFocus();
});
it('does not stack over another dialog, and excludes typing, active scanning and repeated keys', async () => {
  render(<Workspace />);
  const external = document.createElement('div');
  external.setAttribute('role', 'dialog');
  document.body.append(external);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(screen.queryByRole('combobox')).toBeNull();
  external.remove();
  const ordinary = screen.getByLabelText('Ordinary search');
  ordinary.focus();
  fireEvent.keyDown(ordinary, { key: 's' });
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 's', repeat: true });
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
});
it('disables every shortcut including K/help, persists by actor/backend, and leaves buttons working', async () => {
  render(<Workspace />);
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Enable application keyboard shortcuts',
    }),
  );
  expect(
    localStorage.getItem('it-inventory:shortcuts:v1:local-backend:actor'),
  ).toBe('false');
  for (const options of [
    { key: 'k', ctrlKey: true },
    { key: '?' },
    { key: 's' },
    { key: 'n' },
  ])
    fireEvent.keyDown(window, options);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
  expect(screen.getByText(/Application shortcuts are disabled/)).toBeVisible();
});
it('reports unavailable storage honestly with a session fallback', () => {
  render(<Workspace />);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Enable application keyboard shortcuts',
    }),
  );
  expect(
    screen.getByText(/This preference applies to this session/),
  ).toBeVisible();
});
it('expires/cancels G prefix on timeout, focus, blur, and unrelated key; shows held badges', async () => {
  render(<Workspace />);
  fireEvent.keyDown(window, { key: 'g' });
  fireEvent.keyDown(window, { key: 'h' });
  await act(async () => {});
  expect(navigation.push).toHaveBeenLastCalledWith('/history');
  navigation.push.mockClear();
  fireEvent.keyDown(window, { key: 'g' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001);
  });
  fireEvent.keyDown(window, { key: 'h' });
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'g' });
  fireEvent.keyDown(window, { key: 'x' });
  fireEvent.keyDown(window, { key: 'h' });
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'g' });
  fireEvent.focusIn(screen.getByText('Outside'));
  fireEvent.keyDown(window, { key: 'h' });
  await act(async () => {});
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
  expect(screen.getByText('S', { selector: 'kbd' })).toBeVisible();
  fireEvent.blur(window);
  expect(screen.queryByText('S', { selector: 'kbd' })).toBeNull();
});
it('staff N opens the existing tracking choice; viewer N has no task or effect', async () => {
  const view = render(<Workspace staff={false} />);
  fireEvent.keyDown(window, { key: 'n' });
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Workspace />);
  fireEvent.keyDown(window, { key: 'n' });
  fireEvent.click(screen.getByRole('link', { name: 'Add individual asset' }));
  await act(async () => {});
  expect(navigation.push).toHaveBeenCalledWith('/inventory/assets/new');
});
it('debounces, aborts a superseded query, rejects stale replies, and cancels on close', async () => {
  const pending: Array<(value: Response) => void> = [];
  const signals: AbortSignal[] = [];
  vi.mocked(fetch).mockImplementation((_url, options) => {
    signals.push(options!.signal as AbortSignal);
    return new Promise((resolve) => pending.push(resolve));
  });
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'first' } });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(search, { target: { value: 'second' } });
  expect(signals[0].aborted).toBe(true);
  await settle();
  await act(async () => {
    pending[0](response('Stale private record'));
    pending[1](response('Current private record'));
  });
  expect(screen.queryByText('Stale private record')).toBeNull();
  expect(screen.getByText('Current private record')).toBeVisible();
  fireEvent.change(search, { target: { value: 'third' } });
  await settle();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(signals[2].aborted).toBe(true);
  await act(async () => {
    pending[2](response('Late close record'));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('dismisses actor-mismatched results and requires a fresh explicit opening', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(response('Wrong actor', 'other'))
    .mockResolvedValueOnce(response('Fresh actor'));
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'camera' } });
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Wrong actor')).toBeNull();
  fireEvent.change(open(), { target: { value: 'camera' } });
  await settle();
  expect(screen.getByText('Fresh actor')).toBeVisible();
});
it('includes historical scope explicitly, navigates results by keyboard, and opens move/label intents', async () => {
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'camera' } });
  await settle();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body))).toEqual({
    query: 'camera',
    scope: 'active',
    purpose: 'all',
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /Include retired/ }));
  await settle();
  expect(
    JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]!.body)).scope,
  ).toBe('all');
  fireEvent.click(screen.getByRole('option', { name: /Camera laptop/ }));
  await act(async () => {});
  expect(navigation.push).toHaveBeenLastCalledWith(
    '/inventory/assets/' + row.id,
  );
  open();
  fireEvent.click(screen.getByRole('option', { name: /Move asset or stock/ }));
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'camera' },
  });
  await settle();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  await act(async () => {});
  expect(navigation.push).toHaveBeenLastCalledWith(
    '/inventory/assets/' + row.id + '?task=asset_move',
  );
  open();
  fireEvent.click(screen.getByRole('option', { name: /^Print label/ }));
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'camera' },
  });
  await settle();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  await act(async () => {});
  expect(navigation.push).toHaveBeenLastCalledWith('/labels?asset=' + row.id);
});

it.each(['privacy', 'assignment'] as const)(
  'synchronously withdraws the overlay on %s invalidation, aborts late replies, and retains child drafts',
  async (kind) => {
    let complete: (value: Response) => void = () => {};
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, options) => {
      signal = options!.signal as AbortSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    render(<Workspace />);
    const draft = screen.getByLabelText('Retained draft');
    fireEvent.change(draft, { target: { value: 'Keep local draft' } });
    const launcher = screen.getByRole('button', {
      name: 'Search and commands',
    });
    launcher.focus();
    fireEvent.change(open(), { target: { value: 'private' } });
    await settle();
    const modal = screen.getByRole('dialog');
    act(() => {
      if (kind === 'privacy') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
      expect(modal.parentElement).toHaveAttribute('hidden');
      expect(modal.parentElement!.inert).toBe(true);
      expect(signal!.aborted).toBe(true);
    });
    await act(async () => {
      complete(response('Late private data'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Late private data')).toBeNull();
    expect(draft).toHaveValue('Keep local draft');
    expect(launcher).not.toHaveFocus();
  },
);
it('dismisses search during ordinary recheck and never lets getUser alone authorize opening or executing', async () => {
  const view = render(<Workspace />);
  const draft = screen.getByLabelText('Retained draft');
  fireEvent.change(draft, { target: { value: 'Untouched' } });
  open();
  await settle();
  view.rerender(<Workspace fresh={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search and commands' }));
  fireEvent.keyDown(window, { key: 's' });
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(navigation.push).not.toHaveBeenCalled();
  expect(draft).toHaveValue('Untouched');
  view.rerender(<Workspace />);
  open();
  await settle();
  expect(screen.getByRole('combobox')).toHaveValue('');
});
it('rechecks the captured lifetime after a guard synchronously revokes privacy', async () => {
  render(<Workspace />);
  open();
  const remove = registerNavigationGuard(() => {
    revokePrivatePresentation();
    return true;
  });
  try {
    fireEvent.click(screen.getByRole('option', { name: /^Scan/ }));
    await act(async () => {});
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-visible="true"]')).toBeNull();
  } finally {
    remove();
  }
});

it('reconciles an accepted command arrival only after its same-binding fresh grant and real primary return', async () => {
  const view = render(<Workspace />);
  open();
  fireEvent.click(screen.getByRole('option', { name: /^Scan/ }));
  await act(async () => {});
  expect(navigation.push).toHaveBeenCalledWith('/scan');
  view.rerender(<Workspace fresh={false} />);
  navigation.pathname = '/scan';
  history.replaceState({}, '', '/scan');
  view.rerender(<Workspace fresh={false} />);
  expect(screen.getByRole('heading', { name: 'Inventory' })).not.toHaveFocus();
  view.rerender(<Workspace />);
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Inventory' })).toHaveFocus();
});
it('leaves a declined guard dialog in charge of focus without creating route progress', async () => {
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Search and commands' });
  launcher.focus();
  open();
  const external = document.createElement('div');
  external.setAttribute('role', 'alertdialog');
  const stay = document.createElement('button');
  stay.textContent = 'Guard Stay';
  external.append(stay);
  const remove = registerNavigationGuard(() => {
    document.body.append(external);
    stay.focus();
    return false;
  });
  try {
    fireEvent.click(screen.getByRole('option', { name: /^Scan/ }));
    await act(async () => {});
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stay).toHaveFocus();
    expect(document.querySelector('[data-visible="true"]')).toBeNull();
  } finally {
    remove();
    external.remove();
  }
});

it.each([401, 403])(
  'dismisses and clears private search on authoritative endpoint status %s',
  async (status) => {
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    expect(screen.getByText('Camera laptop')).toBeVisible();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Access changed' }), { status }),
    );
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'private query' },
    });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Camera laptop')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Search and commands' }),
    );
    expect(screen.getByRole('combobox')).toHaveValue('');
  },
);

function CachedTaskCommandSource() {
  const path = '/inventory/assets/' + row.id;
  const task = new URLSearchParams(location.search).get('task') ?? undefined;
  return (
    <Authority>
      <CommandProvider actorId="actor" backend="local-backend" staff>
        <CommandButtons />
        <RouteReady
          actorId="actor"
          routeKey={path + '?task=asset_move'}
          contentIdentity={path}
        >
          <main>
            <h1>Asset record</h1>
            <TaskWorkspace
              choices={[{ id: 'asset_move', label: 'Move asset' }]}
              context="Laptop"
              recordIdentity={'asset:' + row.id}
              taskIntent={task}
            >
              {() => <input aria-label="Move destination" />}
            </TaskWorkspace>
          </main>
        </RouteReady>
      </CommandProvider>
    </Authority>
  );
}
it('a real palette Move command reopens a consumed same-record task while the server readiness key remains cached', async () => {
  const path = '/inventory/assets/' + row.id;
  navigation.pathname = path;
  history.replaceState({}, '', path + '?task=asset_move');
  const view = render(<CachedTaskCommandSource />);
  await act(async () => {});
  expect(screen.getByLabelText('Move destination')).toBeVisible();
  expect(location.search).toBe('');
  view.rerender(<CachedTaskCommandSource />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
  expect(screen.queryByLabelText('Move destination')).toBeNull();
  open();
  fireEvent.click(screen.getByRole('option', { name: /Move asset or stock/ }));
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'camera' },
  });
  await settle();
  fireEvent.click(screen.getByRole('option', { name: /Camera laptop/ }));
  await act(async () => {});
  expect(navigation.push).toHaveBeenLastCalledWith(path + '?task=asset_move');
  // Publish the real router commit; source-owned native consumption did not
  // replace or refetch the original server RouteReady key.
  history.replaceState({}, '', path + '?task=asset_move');
  view.rerender(<CachedTaskCommandSource />);
  await act(async () => {});
  expect(screen.getByLabelText('Move destination')).toBeVisible();
  expect(location.search).toBe('');
  view.rerender(<CachedTaskCommandSource />);
  await act(async () => {});
  expect(navigation.push).toHaveBeenCalledTimes(1);
});
