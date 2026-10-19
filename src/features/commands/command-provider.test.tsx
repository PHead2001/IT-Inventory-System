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
import { DocumentAdmission } from '@/app/(protected)/document-admission';
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
    <DocumentAdmission missing>
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
    </DocumentAdmission>
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
  return screen.getByRole<HTMLInputElement>('combobox');
}
it('distinguishes identical location and holding names by canonical breadcrumbs and omits unknown legacy paths', async () => {
  const locations = ['West', 'East'].map((parent, index) => ({
    ...row,
    kind: 'location',
    id: row.id.slice(0, -1) + String(index + 2),
    code: 'PAL-PATH-' + parent,
    name: 'Drawer',
    breadcrumb: 'IT Closet / ' + parent + ' / Drawer',
  }));
  const item = {
    ...row,
    context: {
      places: locations.map((location) => ({
        kind: 'location',
        id: location.id,
        name: location.name,
        code: location.code,
        breadcrumb: location.breadcrumb,
      })),
      hasMore: false,
    },
  };
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        identity: { actorId: 'actor', backend: 'local-backend' },
        result: {
          version: 1,
          rows: [
            ...locations,
            item,
            {
              ...row,
              id: row.id.slice(0, -1) + '9',
              kind: 'location',
              code: 'LEGACY',
              name: 'Legacy drawer',
            },
          ],
          hasMore: false,
        },
      }),
    ),
  );
  render(<Workspace />);
  fireEvent.change(open(), { target: { value: 'drawer' } });
  await settle();
  expect(
    screen.getByRole('option', {
      name: /^Drawer.*IT Closet \/ West \/ Drawer/,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('option', {
      name: /^Drawer.*IT Closet \/ East \/ Drawer/,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('option', { name: /Camera laptop/ }),
  ).toHaveTextContent('Storage: IT Closet / West / Drawer');
  expect(
    screen.getByRole('option', { name: /Camera laptop/ }),
  ).toHaveTextContent('Storage: IT Closet / East / Drawer');
  expect(
    screen.getByRole('option', { name: /Legacy drawer/ }),
  ).not.toHaveTextContent('IT Closet');
});
it.each([
  'dialog',
  'alertdialog',
  'menu',
  'listbox',
  'scanner',
  'exclusive',
] as const)(
  'Ctrl+K ignores hidden/inert retained %s but respects its visible ownership',
  (kind) => {
    render(<Workspace />);
    const wrapper = document.createElement('div');
    const owner = document.createElement('div');
    if (kind === 'scanner') owner.dataset.scannerActive = 'true';
    else if (kind === 'exclusive') owner.dataset.shortcutScope = 'exclusive';
    else owner.setAttribute('role', kind);
    wrapper.append(owner);
    document.body.append(wrapper);
    try {
      for (const state of ['hidden', 'inert', 'visible']) {
        wrapper.hidden = state === 'hidden';
        if (state === 'inert') wrapper.setAttribute('inert', '');
        else wrapper.removeAttribute('inert');
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        if (state === 'visible')
          expect(screen.queryByRole('combobox')).toBeNull();
        else {
          expect(screen.getByRole('combobox')).toBeVisible();
          fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
          expect(screen.queryByRole('combobox')).toBeNull();
        }
      }
    } finally {
      wrapper.remove();
    }
  },
);
it.each(['query', 'native'] as const)(
  'retires palette requests on %s traversal of the same pathname',
  async (kind) => {
    let finish!: (value: Response) => void;
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signal = init!.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const view = render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'private search' } });
    await settle();
    expect(signal.aborted).toBe(false);
    act(() => {
      history.replaceState({}, '', '/inventory?q=other');
      if (kind === 'native')
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    if (kind === 'query') view.rerender(<Workspace />);
    await act(async () => {});
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => finish(response('Stale private reply')));
    expect(screen.queryByText('Stale private reply')).toBeNull();
    expect(open()).toHaveValue('');
  },
);
it.each(['hidden', 'inert', 'visible'] as const)(
  'only a %s retained overlay can block the launcher',
  (state) => {
    const owner = document.createElement('div');
    owner.setAttribute('role', 'dialog');
    owner.hidden = state === 'hidden';
    if (state === 'inert') owner.setAttribute('inert', '');
    document.body.append(owner);
    try {
      render(<Workspace />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Search and commands' }),
      );
      expect(screen.queryByRole('combobox') !== null).toBe(state !== 'visible');
    } finally {
      owner.remove();
    }
  },
);
it.each(['storage', 'site', 'mixed', 'empty', 'legacy'] as const)(
  'renders truthful bounded %s inventory context',
  async (kind) => {
    const storage = {
      kind: 'location',
      id: row.id,
      name: 'Drawer 1',
      code: 'ITC-D01',
    };
    const site = { kind: 'site', id: row.id, name: 'Office', code: 'OFFICE' };
    const context =
      kind === 'legacy'
        ? undefined
        : {
            places:
              kind === 'empty'
                ? []
                : kind === 'mixed'
                  ? [storage, site]
                  : [kind === 'site' ? site : storage],
            hasMore: kind === 'mixed',
          };
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: { version: 1, rows: [{ ...row, context }], hasMore: false },
        }),
      ),
    );
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    const option = screen.getByRole('option', { name: /Camera laptop/ });
    if (kind === 'legacy')
      expect(option).not.toHaveTextContent('No current storage or site');
    else if (kind === 'empty')
      expect(option).toHaveTextContent('No current storage or site');
    else {
      expect(option).toHaveTextContent(
        kind === 'site' ? 'Site: Office' : 'Storage: Drawer 1',
      );
      if (kind === 'mixed')
        expect(option).toHaveTextContent('Site: Office (OFFICE); More places');
    }
  },
);
it('focuses connected Add choices both from N and an existing palette and contains Tab/Escape', async () => {
  render(<Workspace />);
  const launcher = screen.getByRole('button', { name: 'Search and commands' });
  launcher.focus();
  fireEvent.keyDown(window, { key: 'n' });
  await act(async () => {});
  expect(screen.getByRole('link', { name: 'Add quantity item' })).toHaveFocus();
  const last = screen.getByRole('link', { name: 'Add individual asset' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => {});
  expect(launcher).toHaveFocus();
  open();
  await act(async () => {});
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
    await act(async () => {});
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
  // The form publishes its recovery URL before palette verification captures it.
  await act(async () => {});
  open();
  await act(async () => {});
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
  await act(async () => {});
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
    await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Workspace />);
  fireEvent.keyDown(window, { key: 'n' });
  await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
  fireEvent.change(search, { target: { value: 'camera' } });
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Wrong actor')).toBeNull();
  fireEvent.change(open(), { target: { value: 'camera' } });
  await settle();
  expect(screen.getByText('Fresh actor')).toBeVisible();
});
it.each(['Move asset or stock', 'Print label'])(
  'resets keyboard selection when returning from %s results to commands',
  async (task) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: {
            version: 1,
            rows: Array.from({ length: 20 }, (_, index) => ({
              ...row,
              id: row.id.slice(0, -2) + String(index + 1).padStart(2, '0'),
              name: 'Camera ' + index,
            })),
            hasMore: false,
          },
        }),
      ),
    );
    render(<Workspace />);
    const search = open();
    await act(async () => {});
    const taskIndex = screen
      .getAllByRole('option')
      .findIndex((option) => option.textContent?.startsWith(task));
    expect(taskIndex).toBeGreaterThanOrEqual(0);
    for (let index = 0; index < taskIndex; index++)
      fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.change(search, { target: { value: 'camera' } });
    await settle();
    for (let index = 0; index < 19; index++)
      fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[19]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to commands' }));
    // Assert and press Enter before the asynchronous search-effect cleanup.
    expect(screen.getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Add individual asset' }),
    ).toBeVisible();
  },
);
it('includes historical scope explicitly, navigates results by keyboard, and opens move/label intents', async () => {
  render(<Workspace />);
  const search = open();
  await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
  await settle();
  expect(screen.getByRole('combobox')).toHaveValue('');
});
it('rechecks the captured lifetime after a guard synchronously revokes privacy', async () => {
  render(<Workspace />);
  open();
  await act(async () => {});
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
  await act(async () => {});
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
  await act(async () => {});
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
              taskIntent="asset_move"
            >
              {() => <input aria-label="Move destination" />}
            </TaskWorkspace>
          </main>
        </RouteReady>
      </CommandProvider>
    </Authority>
  );
}
it('a real palette Move command reopens a consumed same-record task while server readiness and intent props remain cached', async () => {
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
  await act(async () => {});
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

it.each([
  { name: 'AuthRetryableFetchError', status: 503 },
  { status: 503 },
  { status: 429 },
  { message: 'Unclassified provider failure' },
])(
  'retains the palette and explicit retry after resolved transient Auth failure %j',
  async (error) => {
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error });
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'scan' } });
    search.setSelectionRange(1, 2);
    await settle();
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(
      screen.getByText('Your session could not be checked. Try again.'),
    ).toBeVisible();
    expect(search).toHaveValue('scan');
    expect(search.selectionStart).toBe(1);
    // An unavailable check must not advance the remembered actor identity.
    act(() => auth.listener!('TOKEN_REFRESHED', { user: { id: 'actor' } }));
    expect(screen.getByRole('dialog')).toBeVisible();
    const command = screen.getByRole('option', { name: /^Scan/ });
    expect(command).toBeDisabled();
    fireEvent.click(command);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(fetch).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(search).toHaveValue('scan');
    expect(screen.getByRole('option', { name: /^Scan/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('option', { name: /Camera laptop/ }));
    await act(async () => {});
    expect(navigation.push).toHaveBeenCalledWith('/inventory/assets/' + row.id);
  },
);
it('retains Retry after thrown transport failure and waits for a later verified caller', async () => {
  auth.getUser.mockRejectedValueOnce(new TypeError('Network unavailable'));
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'camera' } });
  await settle();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await settle();
  expect(screen.getByText('Camera laptop')).toBeVisible();
});
it.each([
  { data: { user: { id: 'actor' } }, error: { status: 401 } },
  { data: { user: { id: 'actor' } }, error: { status: 403 } },
  { data: { user: null }, error: { name: 'AuthSessionMissingError' } },
  { data: { user: { id: 'actor' } }, error: { code: 'PGRST301' } },
  { data: { user: null }, error: null },
  { data: { user: { id: 'different-actor' } }, error: null },
])(
  'withdraws the palette for definite Auth denial or missing/mismatched user %j',
  async (result) => {
    auth.getUser.mockResolvedValueOnce(result);
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  },
);
it('withdraws on a thrown definite Auth denial', async () => {
  auth.getUser.mockRejectedValueOnce({ status: 403 });
  render(<Workspace />);
  open();
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['success', 'transient'] as const)(
  'ignores late %s verification after the authenticated actor changes',
  async (kind) => {
    let finish!: (value: unknown) => void;
    auth.getUser.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    act(() => auth.listener!('SIGNED_IN', { user: { id: 'different-actor' } }));
    await act(async () =>
      finish(
        kind === 'success'
          ? { data: { user: { id: 'actor' } }, error: null }
          : { data: { user: null }, error: { status: 503 } },
      ),
    );
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  },
);
it('retires a queued navigation and old results before a transient retry check', async () => {
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'camera' } });
  await settle();
  expect(screen.getByText('Camera laptop')).toBeVisible();
  // A failed subsequent query leaves retry available alongside static commands.
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'Search unavailable' }), {
      status: 503,
    }),
  );
  fireEvent.change(search, { target: { value: 'scan' } });
  await settle();
  // navigate awaits the synchronous shared leave decision. Rechecking in this
  // same turn must retire its queued continuation before it can push.
  fireEvent.click(screen.getByRole('option', { name: /^Scan/ }));
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { status: 503 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await settle();
  expect(screen.getByRole('option', { name: /^Scan/ })).toBeDisabled();
  expect(screen.queryByRole('option', { name: /Camera laptop/ })).toBeNull();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each(['sites', 'mixed'] as const)(
  'uses truthful overflow copy for four %s holdings and preserves each visible kind',
  async (kind) => {
    const holdings = Array.from({ length: 4 }, (_, index) => ({
      kind: kind === 'mixed' && index === 0 ? 'location' : 'site',
      id: row.id.slice(0, -1) + (index + 1),
      name: index === 0 && kind === 'mixed' ? 'Drawer' : 'Office ' + index,
      code: 'PLACE-' + index,
    }));
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: {
            version: 1,
            rows: [
              {
                ...row,
                kind: 'quantity',
                context: { places: holdings.slice(0, 3), hasMore: true },
              },
            ],
            hasMore: false,
          },
        }),
      ),
    );
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    const option = screen.getByRole('option', { name: /Camera laptop/ });
    expect(option).toHaveTextContent('More places');
    expect(option).not.toHaveTextContent('More locations');
    expect(option).toHaveTextContent('Site: Office 1 (PLACE-1)');
    expect(option).toHaveTextContent(
      kind === 'mixed'
        ? 'Storage: Drawer (PLACE-0)'
        : 'Site: Office 0 (PLACE-0)',
    );
    expect(option).not.toHaveTextContent('Office 3');
  },
);

function pendingCaller() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const verifiedCaller = { data: { user: { id: 'actor' } }, error: null };

function deferredSearch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(['fetch', 'body'] as const)(
  'bounds an ignored-abort %s wait including body read and preserves Retry query/cursor',
  async (stage) => {
    const heldResponse = deferredSearch<Response>();
    const heldBody = deferredSearch<unknown>();
    let signal!: AbortSignal;
    const pendingResponse = response();
    if (stage === 'body')
      vi.spyOn(pendingResponse, 'json').mockReturnValueOnce(heldBody.promise);
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options!.signal!;
      return stage === 'fetch'
        ? heldResponse.promise
        : Promise.resolve(pendingResponse);
    });
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'camera' } });
    search.setSelectionRange(1, 3);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(150));
    await act(async () => vi.advanceTimersByTimeAsync(7999));
    expect(
      screen.getByRole('status', { name: 'Searching inventory' }),
    ).toBeVisible();
    expect(signal.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(signal.aborted).toBe(true);
    expect(
      screen.queryByRole('status', { name: 'Searching inventory' }),
    ).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Search could not be loaded. Try again.',
    );
    expect(search).toHaveValue('camera');
    expect(search.selectionStart).toBe(1);
    expect(search.selectionEnd).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByText('Camera laptop')).toBeVisible();
    expect(search.selectionStart).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it.each(['success', 'actor mismatch', 'transient'] as const)(
  'a deadline retires late search-body %s while a verified retry remains current',
  async (kind) => {
    const body = deferredSearch<unknown>();
    const stale = new Response(null, {
      status: kind === 'transient' ? 503 : 200,
    });
    vi.spyOn(stale, 'json').mockReturnValueOnce(body.promise);
    vi.mocked(fetch)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(response('Fresh result'));
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    await act(async () =>
      body.resolve(
        kind !== 'transient'
          ? {
              identity: {
                actorId: kind === 'actor mismatch' ? 'other' : 'actor',
                backend: 'local-backend',
              },
              result: {
                version: 1,
                rows: [{ ...row, name: 'Stale result' }],
                hasMore: false,
              },
            }
          : { error: 'Stale failure' },
      ),
    );
    expect(screen.getByText('Fresh result')).toBeVisible();
    expect(screen.queryByText('Stale result')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog')).toBeVisible();
  },
);

it.each(['query', 'close', 'revocation', 'unmount'] as const)(
  'retires a pending browser search and clears its deadline on %s despite ignored abort',
  async (reason) => {
    const held = deferredSearch<Response>();
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options!.signal!;
      return held.promise;
    });
    const page = render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'camera' } });
    await settle();
    const index = schedule.mock.calls.findLastIndex(
      ([, delay]) => delay === 8000,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const deadline = schedule.mock.results[index].value;
    if (reason === 'query')
      fireEvent.change(search, { target: { value: 'fresh' } });
    else if (reason === 'close') fireEvent.keyDown(window, { key: 'Escape' });
    else if (reason === 'revocation') act(() => revokePrivatePresentation());
    else page.unmount();
    await act(async () => {});
    expect(signal.aborted).toBe(true);
    expect(clear).toHaveBeenCalledWith(deadline);
    await act(async () => held.resolve(response('Stale result')));
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.queryByText('Stale result')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    if (reason === 'query')
      expect(screen.getByText('Camera laptop')).toBeVisible();
    else expect(screen.queryByRole('dialog')).toBeNull();
  },
);

it.each(['search', 'add'] as const)(
  'restores the %s invoker after a declined leave without a surviving guard dialog',
  async (mode) => {
    // Browser animation frames run after the committed dialog removal. Hold
    // this frame explicitly instead of the suite's eager microtask shortcut.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    render(<Workspace />);
    const invoker = screen.getByRole('button', {
      name: mode === 'search' ? 'Search and commands' : 'Outside',
    });
    invoker.focus();
    if (mode === 'search')
      fireEvent.change(open(), { target: { value: 'scan' } });
    else fireEvent.keyDown(window, { key: 'n' });
    await settle();
    const remove = registerNavigationGuard(() => false);
    try {
      fireEvent.click(
        mode === 'search'
          ? screen.getByRole('option', { name: /^Scan/ })
          : screen.getByRole('link', { name: 'Add quantity item' }),
      );
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => frames.splice(0).forEach((frame) => frame(0)));
      expect(invoker).toHaveFocus();
      expect(navigation.push).not.toHaveBeenCalled();
    } finally {
      remove();
    }
  },
);

it('hides historical scope in Move, sends active-only purpose and rejects retired destinations', async () => {
  vi.mocked(fetch).mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: {
            version: 1,
            rows: [
              row,
              {
                ...row,
                id: row.id.slice(0, -1) + '2',
                status: 'retired',
                name: 'Retired equipment',
              },
            ],
            hasMore: false,
          },
        }),
      ),
    ),
  );
  render(<Workspace />);
  open();
  await act(async () => {});
  fireEvent.click(screen.getByRole('checkbox', { name: /Include retired/ }));
  fireEvent.click(screen.getByRole('option', { name: /Move asset or stock/ }));
  expect(
    screen.queryByRole('checkbox', { name: /Include retired/ }),
  ).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'camera' },
  });
  await settle();
  expect(
    JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body)),
  ).toEqual({ query: 'camera', scope: 'active', purpose: 'move' });
  expect(
    screen.queryByRole('option', { name: /Retired equipment/ }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: /Camera laptop/ }));
  await act(async () => {});
  expect(navigation.push).toHaveBeenCalledWith(
    '/inventory/assets/' + row.id + '?task=asset_move',
  );
});

it.each([401, 403])(
  'ignores an aborted fetch resolving status %s after its deadline without starting a stale body read',
  async (status) => {
    const held = deferredSearch<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(response('Fresh result'));
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    const stale = new Response(null, { status });
    const read = vi.spyOn(stale, 'json');
    await act(async () => held.resolve(stale));
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText('Fresh result')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each([
  { status: 401, body: 'stalled' },
  { status: 403, body: 'stalled' },
  { status: 401, body: 'rejecting' },
  { status: 403, body: 'rejecting' },
])(
  'withdraws current status $status before reading its $body body',
  async ({ status, body }) => {
    const denial = new Response(null, { status });
    const read = vi.spyOn(denial, 'json');
    if (body === 'stalled')
      read.mockImplementation(() => new Promise(() => {}));
    else read.mockRejectedValue(new SyntaxError('Malformed denial body'));
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options!.signal!;
      return Promise.resolve(denial);
    });
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  },
);

it.each([401, 403])(
  'ignores superseded query status %s before reading its body',
  async (status) => {
    const held = deferredSearch<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(response('Fresh result'));
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'camera' } });
    await settle();
    fireEvent.change(search, { target: { value: 'fresh' } });
    await settle();
    const denial = new Response(null, { status });
    const read = vi.spyOn(denial, 'json');
    await act(async () => held.resolve(denial));
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByText('Fresh result')).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('shows checking status and disabled Add choices until the caller is verified', async () => {
  const caller = pendingCaller();
  auth.getUser.mockReturnValueOnce(caller.promise);
  render(<Workspace />);
  fireEvent.keyDown(window, { key: 'n' });
  await act(async () => {});
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  for (const name of ['Add quantity item', 'Add individual asset']) {
    const choice = screen.getByRole('link', { name });
    expect(choice).toHaveAttribute('aria-disabled', 'true');
    expect(choice).not.toHaveAttribute('href');
    fireEvent.click(choice);
    fireEvent.click(choice, { ctrlKey: true });
    fireEvent.keyDown(choice, { key: 'Enter' });
  }
  expect(navigation.push).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => caller.resolve(verifiedCaller));
  const quantity = screen.getByRole('link', { name: 'Add quantity item' });
  expect(quantity).toHaveAttribute('href', '/inventory/quantity/new');
  expect(quantity).toHaveFocus();
  expect(screen.queryByText('Checking your session…')).toBeNull();
});

it.each(['resolved', 'thrown'] as const)(
  'keeps Add mode and disabled choices with explicit Retry after %s Auth failure',
  async (kind) => {
    if (kind === 'resolved')
      auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { status: 503 },
      });
    else auth.getUser.mockRejectedValueOnce(new TypeError('Offline'));
    const retry = pendingCaller();
    auth.getUser.mockReturnValueOnce(retry.promise);
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'n' });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Add item' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your session could not be checked. Try again.',
    );
    expect(
      screen.getByRole('link', { name: 'Add individual asset' }),
    ).not.toHaveAttribute('href');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your session',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => retry.resolve(verifiedCaller));
    const choice = screen.getByRole('link', { name: 'Add individual asset' });
    expect(choice).toHaveAttribute('href', '/inventory/assets/new');
    fireEvent.click(choice);
    await act(async () => {});
    expect(navigation.push).toHaveBeenCalledWith('/inventory/assets/new');
  },
);

it.each(['search', 'add'] as const)(
  'bounds a nonsettling caller check in %s mode and recovers through Retry',
  async (mode) => {
    auth.getUser.mockReturnValueOnce(new Promise(() => {}));
    render(<Workspace />);
    let search: HTMLInputElement | undefined;
    if (mode === 'add') fireEvent.keyDown(window, { key: 'n' });
    else {
      search = open();
      fireEvent.change(search, { target: { value: 'scan' } });
      search.setSelectionRange(1, 2);
    }
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(7999));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your session',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your session could not be checked. Try again.',
    );
    if (search) {
      expect(search).toHaveValue('scan');
      expect(search.selectionStart).toBe(1);
      expect(search.selectionEnd).toBe(2);
      expect(screen.getByRole('option', { name: /^Scan/ })).toBeDisabled();
    } else
      expect(
        screen.getByRole('link', { name: 'Add quantity item' }),
      ).not.toHaveAttribute('href');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    if (search) {
      expect(search).toHaveValue('scan');
      expect(search.selectionStart).toBe(1);
      expect(screen.getByRole('option', { name: /^Scan/ })).toBeEnabled();
      expect(fetch).toHaveBeenCalledTimes(1);
    } else
      expect(
        screen.getByRole('link', { name: 'Add quantity item' }),
      ).toHaveFocus();
  },
);

it.each(['success', 'transient', 'denial'] as const)(
  'keeps timeout recovery closed to a late %s without requiring another request',
  async (kind) => {
    const first = pendingCaller();
    auth.getUser.mockReturnValueOnce(first.promise);
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'n' });
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    await act(async () =>
      first.resolve(
        kind === 'success'
          ? verifiedCaller
          : {
              data: { user: null },
              error: { status: kind === 'denial' ? 401 : 503 },
            },
      ),
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your session could not be checked',
    );
    expect(
      screen.getByRole('link', { name: 'Add quantity item' }),
    ).not.toHaveAttribute('href');
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  },
);

it('clears a completed caller deadline so it cannot expire a verified opening', async () => {
  render(<Workspace />);
  const search = open();
  fireEvent.change(search, { target: { value: 'scan' } });
  await settle();
  await act(async () => vi.advanceTimersByTimeAsync(8000));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('option', { name: /^Scan/ })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['success', 'transient', 'denial'] as const)(
  'ignores a timed-out caller check late %s while a newer Retry is pending',
  async (kind) => {
    const first = pendingCaller();
    const retry = pendingCaller();
    auth.getUser
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'scan' } });
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {});
    await act(async () =>
      first.resolve(
        kind === 'success'
          ? verifiedCaller
          : {
              data: { user: null },
              error: { status: kind === 'denial' ? 401 : 503 },
            },
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your session',
    );
    expect(screen.getByRole('option', { name: /^Scan/ })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => retry.resolve(verifiedCaller));
    await settle();
    expect(screen.getByRole('option', { name: /^Scan/ })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each(['close', 'unmount', 'revocation'] as const)(
  'clears the pending caller deadline on %s and ignores late completion',
  async (reason) => {
    const caller = pendingCaller();
    auth.getUser.mockReturnValueOnce(caller.promise);
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const view = render(<Workspace />);
    await act(async () => {});
    open();
    await act(async () => {});
    const deadlineIndex = schedule.mock.calls.findIndex(
      ([, delay]) => delay === 8000,
    );
    expect(deadlineIndex).toBeGreaterThanOrEqual(0);
    const deadline = schedule.mock.results[deadlineIndex].value;
    if (reason === 'unmount') view.unmount();
    else if (reason === 'close') fireEvent.keyDown(window, { key: 'Escape' });
    else act(() => revokePrivatePresentation());
    await act(async () => {});
    expect(clear).toHaveBeenCalledWith(deadline);
    await act(async () => caller.resolve(verifiedCaller));
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  },
);

it.each(['success', 'transient', 'denial'] as const)(
  'does not let late %s overwrite an already verified Retry result',
  async (kind) => {
    const first = pendingCaller();
    auth.getUser.mockReturnValueOnce(first.promise);
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'scan' } });
    search.setSelectionRange(1, 2);
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByRole('option', { name: /^Scan/ })).toBeEnabled();
    await act(async () =>
      first.resolve(
        kind === 'success'
          ? verifiedCaller
          : {
              data: { user: null },
              error: { status: kind === 'denial' ? 403 : 503 },
            },
      ),
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('option', { name: /^Scan/ })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(search).toHaveValue('scan');
    expect(search).toHaveFocus();
    expect(search.selectionStart).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ['asset', 'active', 'Active'],
  ['asset', 'retired', 'Retired'],
  ['quantity', 'archived', 'Archived'],
  ['location', 'inactive', 'Inactive'],
  ['site', 'inactive', 'Inactive'],
] as const)(
  'uses established lifecycle presentation for %s %s',
  async (kind, status, label) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: {
            version: 1,
            rows: [{ ...row, kind, status }],
            hasMore: false,
          },
        }),
      ),
    );
    render(<Workspace />);
    fireEvent.change(open(), { target: { value: 'camera' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Include retired/ }));
    await settle();
    const option = screen.getByRole('option', { name: /Camera laptop/ });
    if (status === 'active') {
      expect(option).not.toHaveTextContent(label);
      expect(screen.queryByText(label, { exact: true })).toBeNull();
    } else {
      expect(option).toHaveTextContent(label);
      expect(screen.getByText(label, { exact: true })).toBeVisible();
    }
    expect(screen.queryByText(status, { exact: true })).toBeNull();
  },
);

it.each(['storage', 'empty', 'legacy'] as const)(
  'labels retired asset %s context as historical without claiming current custody',
  async (kind) => {
    const context =
      kind === 'legacy'
        ? undefined
        : {
            places:
              kind === 'empty'
                ? []
                : [
                    {
                      kind: 'location',
                      id: row.id,
                      name: 'Drawer 1',
                      code: 'ITC-D01',
                      breadcrumb: 'IT Closet / Drawer 1',
                    },
                  ],
            hasMore: false,
          };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          identity: { actorId: 'actor', backend: 'local-backend' },
          result: {
            version: 1,
            rows: [{ ...row, status: 'retired', context }],
            hasMore: false,
          },
        }),
      ),
    );
    render(<Workspace />);
    const search = open();
    fireEvent.change(search, { target: { value: 'camera' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Include retired/ }));
    await settle();
    const option = screen.getByRole('option', { name: /Camera laptop/ });
    expect(option).toHaveTextContent('Retired');
    expect(option).not.toHaveTextContent('No current storage or site');
    if (kind === 'storage') {
      expect(option).toHaveTextContent(
        'Last recorded storage: IT Closet / Drawer 1 (ITC-D01)',
      );
      fireEvent.click(option);
      await act(async () => {});
      expect(navigation.push).toHaveBeenCalledWith(
        '/inventory/assets/' + row.id,
      );
    } else if (kind === 'empty')
      expect(option).toHaveTextContent(
        'No recorded storage or site assignment',
      );
    else expect(option).not.toHaveTextContent(/recorded storage/i);
  },
);
