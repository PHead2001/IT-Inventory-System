import { Component, StrictMode, Suspense, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  RoutePendingContext,
  RouteProgress,
} from '@/components/experience/route-pending';
import { createRoutePendingState } from '@/components/experience/route-pending-state';
import { createRoutePendingOwners } from '@/components/experience/route-pending-owners';
import {
  RouteReady,
  RouteReadyContext,
} from '@/components/experience/route-ready';
import { createRouteReadiness } from '@/components/experience/route-readiness';
import History from './history/loading';
import Labels from './labels/loading';
import AssetForm from './inventory/assets/new/loading';
import QuantityForm from './inventory/quantity/new/loading';
import Forms from './settings/forms/loading';
import Designer from './settings/forms/[categoryId]/loading';
import Event from './history/events/[kind]/[id]/loading';
import Inventory from './inventory/loading';
import Asset from './inventory/assets/[id]/loading';
import Quantity from './inventory/quantity/[id]/loading';

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/history',
  useSearchParams: () => new URLSearchParams(),
}));
beforeEach(() => {
  history.replaceState(null, '', '/history');
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});
function deferredContent() {
  let ready = false;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    read: () => {
      if (!ready) throw promise;
    },
    finish: async () => {
      ready = true;
      resolve();
      await promise;
    },
  };
}
function Content({
  read,
  label = 'Authorized destination',
}: {
  read: () => void;
  label?: string;
}) {
  read();
  return (
    <RouteReady
      actorId="member"
      routeKey="/history"
      contentIdentity="authorized-primary"
    >
      <h1>{label}</h1>
    </RouteReady>
  );
}
function harness() {
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('member', pending, committed);
  const scope = {
    state: pending,
    owners: createRoutePendingOwners(),
    terminal: () => pending.cancel(),
  };
  return {
    pending,
    readiness,
    committed,
    wrap: (children: ReactNode) => (
      <StrictMode>
        <RoutePendingContext.Provider value={scope}>
          <RouteReadyContext.Provider value={readiness}>
            <RouteProgress />
            {children}
          </RouteReadyContext.Provider>
        </RoutePendingContext.Provider>
      </StrictMode>
    ),
  };
}
const progress = () => document.querySelector('.experience-route-progress');

it.each([
  History,
  Labels,
  AssetForm,
  QuantityForm,
  Forms,
  Designer,
  Event,
  Inventory,
  Asset,
  Quantity,
])(
  'tracks an actual %s fallback until authorized content reveals, without finishing unrelated work',
  async (Loading) => {
    const work = deferredContent();
    const runtime = harness();
    const unrelated = runtime.pending.register();
    runtime.readiness.history();
    const { container, unmount } = render(
      runtime.wrap(
        <Suspense fallback={<Loading />}>
          <Content read={work.read} />
        </Suspense>,
      ),
    );
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      container.querySelector('button, input, a, [data-route-ready]'),
    ).toBeNull();
    expect(runtime.committed).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(progress()).toHaveAttribute('data-visible', 'true'),
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await act(work.finish);
    expect(screen.getByRole('heading')).toHaveTextContent(
      'Authorized destination',
    );
    expect(container.querySelector('[data-loading-shape]')).toBeNull();
    expect(runtime.committed).toHaveBeenCalled();
    // Readiness closes only history. The fallback withdraws only its own wait.
    expect(runtime.pending.snapshot().pending).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Working…');
    act(unrelated);
    expect(runtime.pending.snapshot().pending).toBe(false);
    unmount();
  },
);

it('keeps one live announcement across overlapping fallback reveals and a retained Back wait', async () => {
  const runtime = harness();
  const first = deferredContent(),
    second = deferredContent();
  render(
    runtime.wrap(
      <>
        <Suspense fallback={<History />}>
          <Content read={first.read} label="First destination" />
        </Suspense>
        <Suspense fallback={<Labels />}>
          <Content read={second.read} label="Second destination" />
        </Suspense>
      </>,
    ),
  );
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Loading history…');
  act(() => runtime.pending.cancel());
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await act(first.finish);
  expect(runtime.pending.snapshot().pending).toBe(true);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading label workspace…',
  );
  await act(second.finish);
  expect(runtime.pending.snapshot().pending).toBe(false);
  expect(screen.queryByRole('status')).toBeNull();
});

it('retires departed fallback owners without letting late resolution finish a replacement wait', async () => {
  const old = deferredContent(),
    replacement = deferredContent();
  const runtime = harness();
  const view = render(
    runtime.wrap(
      <Suspense key="old" fallback={<History />}>
        <Content read={old.read} />
      </Suspense>,
    ),
  );
  view.rerender(
    runtime.wrap(
      <Suspense key="replacement" fallback={<Labels />}>
        <Content read={replacement.read} />
      </Suspense>,
    ),
  );
  await act(old.finish);
  expect(runtime.pending.snapshot().pending).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading label workspace…',
  );
  view.unmount();
  expect(runtime.pending.snapshot().pending).toBe(false);
  await act(replacement.finish);
  expect(runtime.pending.snapshot().pending).toBe(false);
});

it('never reopens a retired presentation scope when a fallback remains mounted', () => {
  const work = deferredContent();
  const runtime = harness();
  const view = render(
    runtime.wrap(
      <Suspense fallback={<History />}>
        <Content read={work.read} />
      </Suspense>,
    ),
  );
  act(() => runtime.pending.cancel(true));
  expect(runtime.pending.snapshot().pending).toBe(false);
  expect(progress()).toHaveAttribute('data-visible', 'false');
  view.unmount();
});

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">Read failed. Try again.</p>
    ) : (
      this.props.children
    );
  }
}
it('withdraws a failed Suspense fallback immediately without declaring another owner complete', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const work = deferredContent();
  const runtime = harness();
  const unrelated = runtime.pending.register();
  let failed = false;
  const read = () => {
    if (failed) throw new Error('Read failed');
    work.read();
  };
  render(
    runtime.wrap(
      <ErrorBoundary>
        <Suspense fallback={<History />}>
          <Content read={read} />
        </Suspense>
      </ErrorBoundary>,
    ),
  );
  await act(async () => {
    failed = true;
    await work.finish();
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Read failed. Try again.',
  );
  expect(document.querySelector('[data-loading-shape]')).toBeNull();
  expect(runtime.committed).not.toHaveBeenCalled();
  expect(runtime.pending.snapshot().pending).toBe(true);
  act(unrelated);
  expect(runtime.pending.snapshot().pending).toBe(false);
});
