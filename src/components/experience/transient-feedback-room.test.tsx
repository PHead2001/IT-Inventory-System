import { RouteMotionProvider } from './route-motion';
import { MotionPreference } from './motion-preference';
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { createRoomLabelRegistry } from '@/features/room/scene/label-layout-runtime';
import {
  TransientFeedbackProvider,
  useTransientFeedbackOwner,
} from './transient-feedback';

const animation = vi.hoisted(() => ({ updates: [] as (() => void)[] }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('motion', () => ({
  animate: vi.fn((element: HTMLElement, _target, options) => {
    // A measured frame during entry/exit remains painted until its deadline.
    element.style.opacity = '1';
    animation.updates.push(options.onUpdate ?? (() => {}));
    return { cancel: vi.fn() };
  }),
}));
const viewport = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 160,
  bottom: 100,
  width: 160,
  height: 100,
  toJSON() {},
};
let frames: FrameRequestCallback[];
let cardRect: DOMRect;
let resizeCallbacks: ResizeObserverCallback[];
function flush() {
  act(() => {
    const pending = frames;
    frames = [];
    pending.forEach((callback) => callback(0));
  });
}
function Consumer() {
  const host = useRef<HTMLButtonElement>(null),
    feedback = useTransientFeedbackOwner(host);
  const serial = useRef(0);
  return (
    <button
      ref={host}
      onClick={() => {
        const id = String(++serial.current);
        feedback.confirm(feedback.begin(id), id, {
          kind: 'details-saved',
          eventId: id,
        });
      }}
    >
      Save
    </button>
  );
}
function App() {
  return (
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'joined',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      <MotionPreference>
        <RouteMotionProvider actorId="actor">
          <TransientFeedbackProvider
            actorId="actor"
            backend="https://preview.example"
          >
            <Consumer />
          </TransientFeedbackProvider>
        </RouteMotionProvider>
      </MotionPreference>
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  frames = [];
  resizeCallbacks = [];
  animation.updates = [];
  cardRect = viewport as DOMRect;
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    function (this: HTMLElement) {
      return (this.hasAttribute('data-feedback-card') ||
      this.hasAttribute('data-spring-presence')
        ? [cardRect]
        : []) as unknown as DOMRectList;
    },
  );
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-feedback-card')
        ? cardRect
        : original.call(this);
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.motion;
});

it('reflows actual stationary room labels for a global confirmation through close, resize, painted exit and teardown without reviving stale callbacks', () => {
  const surface = document.createElement('div'),
    canvas = document.createElement('canvas'),
    label = document.createElement('button'),
    leader = document.createElement('span');
  surface.dataset.roomSurface = 'true';
  surface.append(canvas, label, leader);
  document.body.append(surface);
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => viewport,
  });
  Object.defineProperty(label, 'getBoundingClientRect', {
    value: () => {
      const [dx, dy] = label.style.transform
        .match(/-?\d+(?:\.\d+)?/g)
        ?.map(Number) ?? [0, 0];
      return {
        ...viewport,
        left: 50 + dx,
        right: 94 + dx,
        top: 30 + dy,
        bottom: 74 + dy,
        width: 44,
        height: 44,
      } as DOMRect;
    },
  });
  const invalidate = vi.fn(),
    registry = createRoomLabelRegistry(vi.fn());
  const disconnect = registry.connect(canvas, invalidate);
  registry.register('location', label, leader, {
    priority: 3,
    locationCode: 'ITC-S1A',
    mandatory: true,
    compact: true,
  });
  flush();
  expect(label.dataset.labelSuppressed, JSON.stringify(canvas.dataset)).toBe(
    'false',
  );
  const revision = readPrivacyRevocationRevision(),
    view = render(<App />);
  try {
    fireEvent.click(screen.getByText('Save'));
    flush();
    expect(label.dataset.labelSuppressed).toBe('true');
    const card = screen
      .getByText('Details saved.')
      .closest('[data-feedback-card]')!;
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    flush();
    const savedAnimation = animation.updates.at(-1)!;
    expect(card.isConnected).toBe(true);
    expect(card).toHaveAttribute('inert');
    expect(screen.queryByRole('status')).toBeNull();
    expect(label.dataset.labelSuppressed).toBe('true');
    cardRect = { ...viewport, top: 80, height: 20 } as DOMRect;
    act(() => resizeCallbacks.at(-1)!([], {} as ResizeObserver));
    flush();
    expect(label.dataset.labelSuppressed).toBe('false');
    cardRect = viewport as DOMRect;
    act(() => savedAnimation());
    flush();
    expect(label.dataset.labelSuppressed).toBe('true');
    act(() => vi.advanceTimersByTime(250));
    flush();
    expect(card.isConnected).toBe(false);
    expect(label.dataset.labelSuppressed).toBe('false');
    const calls = invalidate.mock.calls.length;
    act(() => savedAnimation());
    expect(invalidate).toHaveBeenCalledTimes(calls);
    expect(readPrivacyRevocationRevision()).toBe(revision);
    fireEvent.click(screen.getByText('Save'));
    flush();
    expect(label.dataset.labelSuppressed).toBe('true');
    const staleResize = resizeCallbacks.at(-1)!,
      staleAnimation = animation.updates.at(-1)!;
    act(() => revokePrivatePresentation());
    flush();
    expect(screen.queryByRole('status')).toBeNull();
    expect(label.dataset.labelSuppressed).toBe('false');
    view.unmount();
    const retiredCalls = invalidate.mock.calls.length;
    act(() => {
      staleResize([], {} as ResizeObserver);
      staleAnimation();
    });
    expect(invalidate).toHaveBeenCalledTimes(retiredCalls);
    expect(frames).toHaveLength(0);
  } finally {
    view.unmount();
    disconnect();
    surface.remove();
  }
});
