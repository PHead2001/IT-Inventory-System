import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { ShellAtmosphere } from './shell-atmosphere';
import { RouteMotionProvider } from './route-motion';
import {
  ThemePreferenceProvider,
  useThemePreference,
} from './theme-preference';
vi.mock('next/navigation', () => ({
  usePathname: () => '/room',
  useSearchParams: () => new URLSearchParams(),
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
let frames: Map<number, FrameRequestCallback>;
let id = 0;
const grant = () => ({
  ready: true,
  visible: true,
  generation: 'managed',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function view(
  privacy = grant(),
  actorId = 'actor-a',
  backend = 'https://backend.example',
) {
  return (
    <StrictMode>
      <PrivacyReadinessContext value={privacy}>
        <RouteMotionProvider actorId={actorId}>
          <ShellAtmosphere actorId={actorId} backend={backend}>
            <div data-testid="card" className="experience-spotlight">
              Record
            </div>
          </ShellAtmosphere>
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </StrictMode>
  );
}
function move() {
  const event = new Event('pointermove', { bubbles: true });
  Object.assign(event, {
    pointerType: 'mouse',
    clientX: 30,
    clientY: 40,
    pointerId: 1,
  });
  fireEvent(screen.getByTestId('card'), event);
}
function flush() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}
beforeEach(() => {
  frames = new Map();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: !query.includes('prefers-reduced-motion'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
    frames.delete(handle),
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.documentElement.dataset.motion = 'full';
});
afterEach(() => {
  delete window.inventoryTheme;
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('retains the mounted decorative owner across actual Dark, Light and resolved System choices', () => {
  localStorage.clear();
  document.documentElement.dataset.themeScope = 'test:actor-a';
  window.eval(readFileSync('public/theme-bootstrap.v1.js', 'utf8'));
  let choose!: ReturnType<typeof useThemePreference>['choose'];
  function Choice() {
    choose = useThemePreference().choose;
    return null;
  }
  const mounted = render(
    <ThemePreferenceProvider scope="test:actor-a">
      <PrivacyReadinessContext value={grant()}>
        <RouteMotionProvider actorId="actor-a">
          <ShellAtmosphere actorId="actor-a" backend="https://backend.example">
            <Choice />
            <div data-testid="card" className="experience-spotlight">
              Record
            </div>
          </ShellAtmosphere>
        </RouteMotionProvider>
      </PrivacyReadinessContext>
    </ThemePreferenceProvider>,
  );
  const card = screen.getByTestId('card');
  const host = card.closest('.experience-app')!;
  move();
  flush();
  expect(card).toHaveAttribute('data-spotlight-active', 'true');
  expect(document.documentElement.dataset.theme).toBe('dark');
  for (const [preference, resolved] of [
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'light'],
  ] as const) {
    act(() => choose(preference));
    expect(document.documentElement.dataset.theme).toBe(resolved);
    expect(screen.getByTestId('card')).toBe(card);
    expect(host).toHaveAttribute('data-atmosphere-active', 'true');
    expect(card).not.toHaveAttribute('data-spotlight-active');
    expect(frames.size).toBe(0);
    move();
    flush();
    expect(card).toHaveAttribute('data-spotlight-active', 'true');
  }
  mounted.unmount();
  expect(document.querySelector('.experience-background-ripple')).toBeNull();
});
it('never falls back to unmanaged or retained outgoing authority', () => {
  const mounted = render(view({ ...grant(), generation: 'unmanaged' }));
  move();
  flush();
  const host = screen.getByTestId('card').closest('.experience-app');
  expect(host).toHaveAttribute('data-atmosphere-active', 'false');
  expect(screen.getByTestId('card')).not.toHaveAttribute(
    'data-spotlight-active',
  );
  mounted.rerender(view({ ...grant(), ready: false, visible: true }));
  move();
  flush();
  expect(host).toHaveAttribute('data-atmosphere-active', 'false');
});
it('StrictMode owns one ring and revocation cancels decoration before another React render', () => {
  const mounted = render(view());
  const card = screen.getByTestId('card');
  const host = card.closest('.experience-app')!;
  expect(host.querySelectorAll('.experience-background-ripple')).toHaveLength(
    1,
  );
  move();
  flush();
  expect(card).toHaveAttribute('data-spotlight-active', 'true');
  move();
  act(() => revokePrivatePresentation());
  expect(frames.size).toBe(0);
  expect(card).not.toHaveAttribute('data-spotlight-active');
  expect(host).toHaveAttribute('data-atmosphere-active', 'false');
  mounted.rerender(view());
  expect(host).toHaveAttribute('data-atmosphere-active', 'true');
  expect(card).not.toHaveAttribute('data-spotlight-active');
  move();
  flush();
  expect(card).toHaveAttribute('data-spotlight-active', 'true');
  mounted.unmount();
  expect(frames.size).toBe(0);
});
it('resets actor A-B-A state and ancestor hiding without replay on reopening', async () => {
  const mounted = render(view());
  const card = screen.getByTestId('card');
  move();
  flush();
  expect(card).toHaveAttribute('data-spotlight-active', 'true');
  mounted.rerender(view(grant(), 'actor-b'));
  expect(card).not.toHaveAttribute('data-spotlight-active');
  mounted.rerender(view());
  expect(frames.size).toBe(0);
  move();
  flush();
  expect(card).not.toHaveAttribute('data-spotlight-active');
  mounted.rerender(view(grant(), 'actor-a', 'https://different.example'));
  expect(card).not.toHaveAttribute('data-spotlight-active');
  mounted.rerender(view());
  expect(frames.size).toBe(0);
  move();
  flush();
  expect(card).not.toHaveAttribute('data-spotlight-active');
  mounted.unmount();
  const fresh = render(view());
  const freshCard = screen.getByTestId('card');
  fresh.container.setAttribute('inert', '');
  await act(async () => {});
  expect(freshCard).not.toHaveAttribute('data-spotlight-active');
  fresh.container.removeAttribute('inert');
  await act(async () => {});
  expect(freshCard).not.toHaveAttribute('data-spotlight-active');
  move();
  flush();
  expect(freshCard).toHaveAttribute('data-spotlight-active', 'true');
});

it('rejects stale epochs/revisions, pauses a hidden tab and remounts without old decoration', () => {
  const mounted = render(view());
  const card = screen.getByTestId('card');
  const host = card.closest('.experience-app')!;
  move();
  flush();
  mounted.rerender(view({ ...grant(), verifiedEpoch: assignmentEpoch() - 1 }));
  expect(card).not.toHaveAttribute('data-spotlight-active');
  expect(host).toHaveAttribute('data-atmosphere-active', 'false');
  mounted.rerender(
    view({
      ...grant(),
      revocationRevision: readPrivacyRevocationRevision() - 1,
    }),
  );
  move();
  flush();
  expect(card).not.toHaveAttribute('data-spotlight-active');
  mounted.rerender(view());
  move();
  flush();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(host).toHaveAttribute('data-atmosphere-active', 'false');
  expect(card).not.toHaveAttribute('data-spotlight-active');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(host).toHaveAttribute('data-atmosphere-active', 'true');
  expect(frames.size).toBe(0);
  mounted.unmount();
  render(view());
  expect(screen.getByTestId('card')).not.toHaveAttribute(
    'data-spotlight-active',
  );
  expect(
    document.querySelectorAll('.experience-background-ripple'),
  ).toHaveLength(1);
});
