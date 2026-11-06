import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ContextType,
  type ReactNode,
} from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import {
  PrivacyReadinessContext,
  type usePrivacyReadiness,
} from '@/components/auth/privacy-readiness';
import { RouteMotionProvider } from '@/components/experience/route-motion';
import {
  RoutePendingContext,
  useRouteActionResult,
  useRouteTask,
} from '@/components/experience/route-pending';
import { RouteReady } from '@/components/experience/route-ready';
import { ThemePreferenceProvider } from '@/components/experience/theme-preference';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { useOverviewRefreshAuthority } from './refresh-authority';
import { OverviewView } from './overview-view';
import { parseOverviewProjection } from './contracts';
import { overviewFixture } from './test-fixtures';
import type { OverviewResult } from './refresh-contract';

const runtime = vi.hoisted(() => ({
  action: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('./refresh.actions', () => ({ refreshOverview: runtime.action }));
vi.mock('@/components/experience/closet-preview', () => ({
  ClosetPreview: () => null,
}));
vi.mock('@/components/experience/magnetic-visual', () => ({
  MagneticVisual: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: runtime.refresh, replace: runtime.replace }),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));

type Result = { ok: true; name: string } | { ok: false; code: 'forbidden' };
function deferred<T = Result>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let mounts = 0;
let controls: {
  scope: NonNullable<ContextType<typeof RoutePendingContext>>;
  deny: ReturnType<typeof useRouteActionResult>;
};
function Controls() {
  const scope = useContext(RoutePendingContext)!;
  const deny = useRouteActionResult();
  useLayoutEffect(() => {
    controls = { scope, deny };
  });
  return null;
}
function Request() {
  const authority = useOverviewRefreshAuthority();
  const [pending, startTask] = useRouteTask();
  const [name, setName] = useState('Original snapshot');
  useLayoutEffect(() => {
    mounts++;
  }, []);
  return (
    <>
      <button
        disabled={pending}
        onClick={() => {
          const current = authority.capture();
          startTask(async () => {
            const action = runtime.action() as Promise<Result>;
            const result = await action;
            if (!current.current()) return;
            await authority.observe(action);
            if (current.current() && result.ok) setName(result.name);
          });
        }}
      >
        Refresh test snapshot
      </button>
      <p>{name}</p>
    </>
  );
}

/** Replace the real pending provider's scope without remounting its child.
 * This exercises the same owner retirement/context replacement contract. */
function ScopeReplacement({
  identity,
  children,
}: {
  identity: number;
  children: ReactNode;
}) {
  const parent = useContext(RoutePendingContext);
  const scope = useMemo(
    () => parent && { ...parent, replacement: identity },
    [parent, identity],
  );
  return (
    <RoutePendingContext.Provider value={scope}>
      {children}
    </RoutePendingContext.Provider>
  );
}
function grant(
  generation = 'A',
  ready = true,
): ReturnType<typeof usePrivacyReadiness> {
  return {
    ready,
    visible: ready,
    generation,
    revocationRevision: readPrivacyRevocationRevision(),
    verifiedEpoch: assignmentEpoch(),
  };
}
function tree(
  privacy = grant(),
  provider = 1,
  children: ReactNode = <Request />,
) {
  return (
    <PrivacyReadinessContext.Provider value={privacy}>
      <ThemePreferenceProvider scope="overview:isolated-test">
        <RouteMotionProvider actorId="test-actor">
          <ScopeReplacement identity={provider}>
            <ProtectedPrivacyContent>
              <RouteReady
                actorId="test-actor"
                routeKey="/dashboard"
                contentIdentity="/dashboard"
                conventionalPrimary
              >
                <Controls />
                {children}
              </RouteReady>
            </ProtectedPrivacyContent>
          </ScopeReplacement>
        </RouteMotionProvider>
      </ThemePreferenceProvider>
    </PrivacyReadinessContext.Provider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mounts = 0;
  sessionStorage.clear();
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('CSS', { supports: () => false });
  document.documentElement.dataset.motion = 'reduced';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
});

it('rejects a deferred response after revocation and same-account re-verification while the private child stays mounted', async () => {
  const old = deferred();
  runtime.action.mockReturnValueOnce(old.promise);
  const view = render(tree());
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh test snapshot' }),
  );
  act(() => revokePrivatePresentation());
  view.rerender(tree(grant('A', false)));
  expect(screen.getByText('Original snapshot')).not.toBeVisible();
  view.rerender(tree(grant()));
  await waitFor(() =>
    expect(screen.getByText('Original snapshot')).toBeVisible(),
  );
  await act(async () => old.resolve({ ok: true, name: 'Retired response' }));
  expect(screen.queryByText('Retired response')).not.toBeInTheDocument();
  expect(mounts).toBe(1);
});

it('rejects A → B → A completion even when the final generation string matches the original', async () => {
  const old = deferred();
  runtime.action.mockReturnValueOnce(old.promise);
  const view = render(tree());
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh test snapshot' }),
  );
  view.rerender(tree(grant('B', false)));
  view.rerender(tree(grant('A')));
  await act(async () => old.resolve({ ok: true, name: 'Retired response' }));
  expect(screen.queryByText('Retired response')).not.toBeInTheDocument();
  expect(mounts).toBe(1);
});

it('retires completion authority on pending provider replacement without unmounting the consumer', async () => {
  const old = deferred();
  runtime.action.mockReturnValueOnce(old.promise);
  const view = render(tree());
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh test snapshot' }),
  );
  view.rerender(tree(grant(), 2));
  await act(async () => old.resolve({ ok: true, name: 'Retired response' }));
  expect(screen.queryByText('Retired response')).not.toBeInTheDocument();
  expect(mounts).toBe(1);
});

it('an old denial cannot suppress the successor provider or consume its response', async () => {
  const old = deferred(),
    successor = deferred();
  runtime.action
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(successor.promise);
  const view = render(tree());
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh test snapshot' }),
  );
  view.rerender(tree(grant(), 2));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh test snapshot' }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh test snapshot' }),
  );
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  await act(async () => old.resolve({ ok: false, code: 'forbidden' }));
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  expect(
    screen.getByRole('button', { name: 'Refresh test snapshot' }),
  ).toBeDisabled();
  await act(async () =>
    successor.resolve({ ok: true, name: 'Successor snapshot' }),
  );
  expect(screen.getByText('Successor snapshot')).toBeVisible();
  expect(mounts).toBe(1);
});

it.each([
  ['cancel', 'success'],
  ['other-denial', 'success'],
  ['cancel', 'transient'],
  ['other-denial', 'transient'],
] as const)(
  'rejects deferred %s retirement followed by %s on the same provider',
  async (retirement, result) => {
    const old = deferred<OverviewResult>();
    runtime.action.mockReturnValueOnce(old.promise);
    const data = {
      ...parseOverviewProjection(overviewFixture()),
      fetchedAt: '2026-10-14T12:01:00Z',
    };
    render(
      tree(
        grant(),
        1,
        <OverviewView
          serverRevision="initial"
          initialSnapshot={data}
          initialMayEdit={false}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
    const scope = controls.scope;
    if (retirement === 'cancel') act(() => scope.state.cancel(true));
    else
      await act(async () => {
        await controls.deny(Promise.resolve({ ok: false, code: 'forbidden' }));
      });
    expect(controls.scope).toBe(scope);
    const replacement = {
      ...data,
      stock: {
        ...data.stock,
        attention: data.stock.attention.map((item) => ({
          ...item,
          name: 'Retired response',
        })),
      },
    };
    await act(async () =>
      old.resolve(
        result === 'success'
          ? { ok: true, snapshot: replacement, mayEdit: true }
          : {
              ok: false,
              code: 'unexpected',
              clearSnapshot: false,
              mayEdit: true,
            },
      ),
    );
    expect(screen.queryByText('Retired response')).not.toBeInTheDocument();
    expect(screen.getAllByText('Cable').length).toBeGreaterThan(0);
    expect(screen.queryByText('Add item')).not.toBeInTheDocument();
    expect(screen.queryByText('Overview refreshed.')).not.toBeInTheDocument();
  },
);

it('clears real Overview data and edit permissions after its own current denial observer retires the epoch', async () => {
  const request = deferred<OverviewResult>();
  runtime.action.mockReturnValueOnce(request.promise);
  const data = {
    ...parseOverviewProjection(overviewFixture()),
    fetchedAt: '2026-10-14T12:01:00Z',
  };
  const { container } = render(
    tree(
      grant(),
      1,
      <OverviewView
        serverRevision="initial"
        initialSnapshot={data}
        initialMayEdit
      />,
    ),
  );
  expect(screen.getAllByText('Cable').length).toBeGreaterThan(0);
  expect(screen.getByText('Add item')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }));
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('true');
  await act(async () =>
    request.resolve({ ok: false, code: 'forbidden', clearSnapshot: true }),
  );
  expect(document.documentElement.dataset.routeMotionPrivate).toBe('false');
  expect(
    screen.getByText(/Private Overview data has been cleared/),
  ).toBeInTheDocument();
  expect(screen.queryByText('Cable')).not.toBeInTheDocument();
  expect(container.querySelector('time')).toBeNull();
  expect(screen.queryByText('Add item')).not.toBeInTheDocument();
});
