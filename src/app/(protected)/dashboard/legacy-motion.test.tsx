import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { ShellAtmosphere } from '@/components/experience/shell-atmosphere';
import { RouteMotionProvider } from '@/components/experience/route-motion';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';

vi.mock('server-only', () => ({}));
vi.mock('@/features/overview/queries.server', () => ({
  getOverviewSnapshot: vi.fn(),
}));
vi.mock('@/lib/auth/session.server', () => ({ requireMember: vi.fn() }));

const mocks = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn() }));
vi.mock('./snapshot.server', () => ({ loadDashboardSnapshot: mocks.load }));
vi.mock('./refresh.actions', () => ({ refreshDashboard: mocks.refresh }));
vi.mock('@/components/experience/route-ready.server', () => ({
  routeReadyProps: async () => ({
    actorId: 'staff',
    routeKey: '/dashboard',
    contentIdentity: 'current-overview',
    conventionalPrimary: true,
  }),
}));
vi.mock('@/components/auth/privacy-content', () => ({
  ProtectedPrivacyContent: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
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
import DashboardPage from './page';

let frames: Map<number, FrameRequestCallback>;
let serial = 0;
const snapshot = {
  fetchedAt: '2026-10-07T10:00:00Z',
  result: {
    configuredCount: 2,
    needsRestockingCount: 1,
    outOfStockCount: 0,
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  },
};
const fresh = (ready = true) => ({
  ready,
  visible: true,
  generation: 'current-overview-w10',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function tree(page: ReactNode, ready = true) {
  return (
    <PrivacyReadinessContext value={fresh(ready)}>
      <RouteMotionProvider actorId="staff">
        <ShellAtmosphere actorId="staff" backend="https://overview.test">
          {page}
        </ShellAtmosphere>
      </RouteMotionProvider>
    </PrivacyReadinessContext>
  );
}
function move(target: Element, pointerType = 'mouse') {
  const event = new Event('pointermove', { bubbles: true });
  Object.assign(event, { clientX: 100, clientY: 0, pointerType, pointerId: 1 });
  fireEvent(target, event);
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
beforeEach(() => {
  mocks.load.mockResolvedValue(snapshot);
  frames = new Map();
  serial = 0;
  document.documentElement.dataset.motion = 'full';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('hover: hover'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 100),
  );
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 100, 100),
  ] as unknown as DOMRectList);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('tilts the actual hero illustration and three semantic count tiles while their owners, navigation and exact counts stay stationary', async () => {
  const page = await DashboardPage({
    searchParams: Promise.resolve({ view: 'low-stock' }),
  });
  const view = render(tree(page));
  const hosts = [
    ...view.container.querySelectorAll<HTMLElement>('.experience-tilt'),
  ];
  expect(hosts).toHaveLength(4);
  const hero = view.container.querySelector<HTMLElement>(
    '.experience-closet-preview',
  )!;
  expect(
    hero.querySelector(':scope > .experience-tilt-visual svg'),
  ).not.toBeNull();
  const counts = screen.getByRole('group', { name: 'Storage health counts' });
  expect(
    within(counts)
      .getAllByRole('term')
      .map((node) => node.textContent),
  ).toEqual([
    'Needs restocking',
    'Out of stock (subset)',
    'Monitored active items',
  ]);
  expect(
    [...counts.querySelectorAll('[data-count-final]')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['1', '0', '2']);
  for (const term of within(counts).getAllByRole('term'))
    expect(term.parentElement?.tagName).toBe('DL');
  const link = screen.getByRole('link', { name: /Explore Spaces/ });
  link.focus();
  for (const host of hosts) {
    move(host);
    expect(host.dataset.pointerActive).toBe('true');
    expect(host.style.transform).toBe('');
    expect(
      Math.hypot(
        Number(host.style.getPropertyValue('--pointer-x')),
        Number(host.style.getPropertyValue('--pointer-y')),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      host.querySelector(':scope > .experience-tilt-visual'),
    ).not.toBeNull();
    expect(link).toHaveFocus();
  }
  expect(link).toHaveAttribute('href', '/room');
  expect(link.closest('.experience-tilt-visual')).toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Refresh overview' })
      .closest('.experience-tilt-visual'),
  ).toBeNull();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.load).toHaveBeenCalledWith(1);
});

it('neutralizes actual Overview tilt immediately on touch, canonical Reduced motion and current owner withdrawal', async () => {
  const page = await DashboardPage({
    searchParams: Promise.resolve({ view: 'low-stock' }),
  });
  const view = render(tree(page));
  const tile = screen
    .getByText('Needs restocking')
    .closest('.experience-tilt') as HTMLElement;
  const refresh = screen.getByRole('button', { name: 'Refresh overview' });
  move(tile);
  expect(tile.dataset.pointerActive).toBe('true');
  move(tile, 'touch');
  expect(tile.dataset.pointerActive).toBeUndefined();
  move(tile);
  expect(tile.dataset.pointerActive).toBe('true');
  await act(async () => {
    document.documentElement.dataset.motion = 'reduced';
  });
  expect(tile.dataset.pointerActive).toBeUndefined();
  expect(tile.style.getPropertyValue('--pointer-x')).toBe('');
  await act(async () => {
    document.documentElement.dataset.motion = 'full';
  });
  expect(tile.dataset.pointerActive).toBeUndefined();
  move(tile);
  expect(tile.dataset.pointerActive).toBe('true');
  view.rerender(tree(page, false));
  expect(tile.dataset.pointerActive).toBeUndefined();
  move(tile);
  expect(tile.dataset.pointerActive).toBeUndefined();
  expect(tile.style.transform).toBe('');
  expect(refresh).toBeEnabled();
});
