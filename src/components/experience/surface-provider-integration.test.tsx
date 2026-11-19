import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useContext, useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import type { LogoutPrivacyGeneration } from '@/lib/auth/privacy-barrier';
import { ShellAtmosphere } from './shell-atmosphere';
import { RouteMotionProvider, useRouteCommandBoundary } from './route-motion';
import { RoutePendingContext, useRouteTask } from './route-pending';
import { RouteReady } from './route-ready';
import { MotionPreference, MotionToggle } from './motion-preference';
import { MagneticVisual } from './magnetic-visual';
import {
  ThemePreferenceProvider,
  VerifiedThemeScope,
  useThemePreference,
} from './theme-preference';
import { observeRouteActionResult } from './route-action-result';

const runtime = vi.hoisted(() => ({
  read: vi.fn(),
  identity: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: runtime.replace, refresh: runtime.refresh }),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));
const binding = {
  actorId: 'staff',
  backend: 'https://isolated.example',
  role: 'staff' as const,
  canManageConfiguration: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let frames: Map<number, FrameRequestCallback>;
let serial = 0;
let work: ReturnType<typeof deferred<void>>;
let mounts = 0;
let controls: {
  scope: NonNullable<React.ContextType<typeof RoutePendingContext>>;
  command: ReturnType<typeof useRouteCommandBoundary>;
  theme: ReturnType<typeof useThemePreference>;
};
function Business() {
  const scope = useContext(RoutePendingContext)!;
  const command = useRouteCommandBoundary(binding.actorId, binding.backend);
  const theme = useThemePreference();
  const [busy, run] = useRouteTask();
  useLayoutEffect(() => {
    controls = { scope, command, theme };
  });
  useLayoutEffect(() => {
    mounts++;
  }, []);
  return (
    <section
      className="experience-spotlight experience-tilt"
      data-testid="surface-card"
    >
      <span className="experience-tilt-visual">Standalone Overview tile</span>
      <button
        type="button"
        className="experience-magnetic"
        data-testid="surface-action"
      >
        <MagneticVisual>Add item</MagneticVisual>
      </button>
      <MotionToggle />
      <input aria-label="Retained surface draft" defaultValue="original" />
      <button disabled={busy} onClick={() => run(() => work.promise)}>
        Save original request
      </button>
    </section>
  );
}
function tree(owner = binding) {
  return (
    <ThemePreferenceProvider scope="test:anonymous">
      <ProtectedPrivacyBoundary
        serverGeneration={{ status: 'absent' }}
        binding={owner}
      >
        <MotionPreference>
          <RouteMotionProvider actorId={owner.actorId}>
            <ShellAtmosphere actorId={owner.actorId} backend={owner.backend}>
              <ProtectedPrivacyContent>
                <VerifiedThemeScope scope="test:staff" />
                <RouteReady
                  actorId="staff"
                  routeKey="/inventory"
                  contentIdentity="surface-primary"
                  conventionalPrimary
                >
                  <Business />
                </RouteReady>
              </ProtectedPrivacyContent>
            </ShellAtmosphere>
          </RouteMotionProvider>
        </MotionPreference>
      </ProtectedPrivacyBoundary>
    </ThemePreferenceProvider>
  );
}
function move() {
  const event = new Event('pointermove', { bubbles: true });
  Object.assign(event, {
    clientX: 30,
    clientY: 40,
    pointerType: 'mouse',
    pointerId: 1,
  });
  fireEvent(screen.getByTestId('surface-action'), event);
}
function flush() {
  const queued = [...frames.values()];
  frames.clear();
  act(() => queued.forEach((callback) => callback(0)));
}
async function admitted() {
  const view = render(tree());
  await screen.findByRole('textbox');
  await waitFor(() => expect(controls.command.authorized()).toBe(true));
  return view;
}
beforeEach(() => {
  frames = new Map();
  mounts = 0;
  work = deferred<void>();
  sessionStorage.clear();
  localStorage.clear();
  runtime.read.mockReset().mockResolvedValue({ status: 'absent' });
  runtime.identity
    .mockReset()
    .mockResolvedValue({ status: 'match', generation: { status: 'absent' } });
  runtime.replace.mockReset();
  runtime.refresh.mockReset();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('navigation', new EventTarget());
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: fine'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  document.documentElement.dataset.motion = 'full';
  document.documentElement.dataset.themeScope = 'test:anonymous';
  window.eval(readFileSync('public/theme-bootstrap.v1.js', 'utf8'));
  history.replaceState({}, '', '/inventory');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.inventoryTheme;
  history.replaceState({}, '', '/');
});

it('waits for actual initial verification and preserves accepted command, draft, pending request and scope through a theme choice', async () => {
  const initial = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(initial.promise);
  render(tree());
  expect(document.querySelector('.experience-app')).toHaveAttribute(
    'data-atmosphere-active',
    'false',
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  await act(async () => {
    initial.resolve({ status: 'absent' });
    await initial.promise;
  });
  await waitFor(() => expect(controls.command.authorized()).toBe(true));
  const card = screen.getByTestId('surface-card');
  const host = card.closest('.experience-app');
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'retained input' } });
  const ticket = controls.command.issue('/inventory');
  act(() => controls.scope.navigation!('/inventory'));
  expect(ticket?.current()).toBe(true);
  const capture = controls.command.capture();
  const revision = readPrivacyRevocationRevision(),
    epoch = assignmentEpoch();
  move();
  flush();
  expect(card).toHaveAttribute('data-spotlight-active', 'true');
  expect(card).toHaveAttribute('data-pointer-active', 'true');
  expect(screen.getByTestId('surface-action')).toHaveAttribute(
    'data-pointer-active',
    'true',
  );
  act(() => controls.theme.choose('light'));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(screen.getByTestId('surface-card')).toBe(card);
  expect(card.closest('.experience-app')).toBe(host);
  expect(controls.command.authorized()).toBe(true);
  expect(capture()).toBe(true);
  expect(ticket?.current()).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Save original request' }),
  );
  const pendingEpoch = controls.scope.state.snapshot().epoch;
  act(() => controls.theme.choose('dark'));
  expect(controls.scope.state.snapshot()).toMatchObject({
    epoch: pendingEpoch,
    pending: true,
  });
  expect(host).toHaveAttribute('data-atmosphere-active', 'true');
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('retained input');
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeDisabled();
  expect(mounts).toBe(1);
  expect(readPrivacyRevocationRevision()).toBe(revision);
  expect(assignmentEpoch()).toBe(epoch);
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeEnabled();
  expect(host).toHaveAttribute('data-atmosphere-active', 'true');
});

it('withdraws during an actual retained ordinary recheck without retiring business work, then requires a fresh pointer after verification', async () => {
  await admitted();
  const draft = screen.getByRole('textbox');
  const card = screen.getByTestId('surface-card');
  fireEvent.change(draft, { target: { value: 'retained recheck' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save original request' }),
  );
  move();
  flush();
  move();
  const stale = [...frames.values()][0];
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(card).not.toHaveAttribute('data-spotlight-active');
  expect(card).not.toHaveAttribute('data-pointer-active');
  expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
    'data-pointer-active',
  );
  act(() => stale(0));
  expect(card).not.toHaveAttribute('data-spotlight-active');
  expect(card).not.toHaveAttribute('data-pointer-active');
  expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
    'data-pointer-active',
  );
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('retained recheck');
  expect(
    screen.getByRole('button', { name: 'Save original request' }),
  ).toBeDisabled();
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
  });
  expect(card).not.toHaveAttribute('data-spotlight-active');
  expect(card).not.toHaveAttribute('data-pointer-active');
  expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
    'data-pointer-active',
  );
  move();
  flush();
  expect(card).toHaveAttribute('data-spotlight-active', 'true');
  expect(card).toHaveAttribute('data-pointer-active', 'true');
  expect(screen.getByTestId('surface-action')).toHaveAttribute(
    'data-pointer-active',
    'true',
  );
  expect(mounts).toBe(1);
  await act(async () => {
    work.resolve();
    await work.promise;
  });
});

it('synchronously clears queued decoration on real revocation and keeps another actor and late verification ineligible', async () => {
  const view = await admitted();
  const card = screen.getByTestId('surface-card');
  move();
  flush();
  move();
  const stale = [...frames.values()][0];
  const check = deferred<LogoutPrivacyGeneration>();
  runtime.read.mockReturnValueOnce(check.promise);
  act(() => {
    revokePrivatePresentation();
    expect(card).not.toHaveAttribute('data-spotlight-active');
    expect(card).not.toHaveAttribute('data-pointer-active');
    expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
      'data-pointer-active',
    );
    expect(frames.size).toBe(0);
  });
  const revision = readPrivacyRevocationRevision(),
    epoch = assignmentEpoch();
  runtime.identity.mockResolvedValue({ status: 'denied' });
  view.rerender(tree({ ...binding, actorId: 'other' }));
  await screen.findByText(/original account access could not be verified/);
  await act(async () => {
    check.resolve({ status: 'absent' });
    await check.promise;
    stale(0);
  });
  expect(card).not.toHaveAttribute('data-spotlight-active');
  expect(card).not.toHaveAttribute('data-pointer-active');
  expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
    'data-pointer-active',
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(runtime.identity).toHaveBeenCalledWith(binding);
  expect(mounts).toBe(1);
  expect(readPrivacyRevocationRevision()).toBeGreaterThanOrEqual(revision);
  expect(assignmentEpoch()).toBeGreaterThanOrEqual(epoch);
});

it.each(['forbidden', 'actor_changed'] as const)(
  'terminal %s presentation denial vetoes decoration without granting or revoking membership',
  async (code) => {
    const view = await admitted();
    const card = screen.getByTestId('surface-card');
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'denied retained draft' } });
    move();
    flush();
    move();
    const stale = [...frames.values()][0];
    const revision = readPrivacyRevocationRevision(),
      epoch = assignmentEpoch();
    await act(async () => {
      await observeRouteActionResult(Promise.resolve({ ok: false, code }));
      expect(card).not.toHaveAttribute('data-spotlight-active');
      expect(card).not.toHaveAttribute('data-pointer-active');
      expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
        'data-pointer-active',
      );
      expect(frames.size).toBe(0);
    });
    expect(readPrivacyRevocationRevision()).toBe(revision);
    expect(assignmentEpoch()).toBe(epoch);
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveValue('denied retained draft');
    view.rerender(tree());
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() =>
      expect(runtime.read.mock.calls.length).toBeGreaterThan(1),
    );
    await act(async () => {
      await Promise.resolve();
      stale(0);
    });
    move();
    flush();
    expect(card).not.toHaveAttribute('data-spotlight-active');
    expect(card).not.toHaveAttribute('data-pointer-active');
    expect(card.querySelector('.experience-magnetic')).not.toHaveAttribute(
      'data-pointer-active',
    );
    expect(card.closest('.experience-app')).toHaveAttribute(
      'data-atmosphere-active',
      'false',
    );
    expect(mounts).toBe(1);
  },
);

it('inherits the actual manual motion switch and recovers without replay, command replacement or remount', async () => {
  await admitted();
  const card = screen.getByTestId('surface-card');
  const action = screen.getByTestId('surface-action');
  const draft = screen.getByRole('textbox');
  const toggle = screen.getByRole('switch', {
    name: 'Reduce motion in this browser',
  });
  const revision = readPrivacyRevocationRevision(),
    epoch = assignmentEpoch();
  const capture = controls.command.capture();
  move();
  flush();
  move();
  const late = [...frames.values()][0];
  expect(action).toHaveAttribute('data-pointer-active', 'true');
  try {
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(document.documentElement.dataset.motion).toBe('reduced'),
    );
    expect(card).not.toHaveAttribute('data-pointer-active');
    expect(action).not.toHaveAttribute('data-pointer-active');
    act(() => late(0));
    expect(action.style.getPropertyValue('--pointer-x')).toBe('');
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(capture()).toBe(true);
    expect(readPrivacyRevocationRevision()).toBe(revision);
    expect(assignmentEpoch()).toBe(epoch);
    expect(mounts).toBe(1);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(document.documentElement.dataset.motion).toBe('full'),
    );
    expect(action).not.toHaveAttribute('data-pointer-active');
    move();
    flush();
    expect(action).toHaveAttribute('data-pointer-active', 'true');
  } finally {
    if (toggle.getAttribute('aria-checked') === 'true') fireEvent.click(toggle);
  }
});
