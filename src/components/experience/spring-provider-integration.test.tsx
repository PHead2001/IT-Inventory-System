import { useLayoutEffect, useRef, useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import type { LogoutPrivacyGeneration } from '@/lib/auth/privacy-barrier';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { MotionPreference } from './motion-preference';
import { RouteMotionProvider, useRouteCommandBoundary } from './route-motion';
import { RouteReady } from './route-ready';
import { observeRouteActionResult } from './route-action-result';
import { SpringPresence } from './spring-presence';
import { SpringDisclosure } from './spring-disclosure';
import {
  TransientFeedbackProvider,
  useTransientFeedbackOwner,
} from './transient-feedback';
import { animate } from 'motion';

const runtime = vi.hoisted(() => ({
  read: vi.fn(),
  identity: vi.fn(),
  updates: [] as (() => void)[],
  stops: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('@/lib/auth/privacy-read-transport', () => ({
  readLogoutPrivacyGeneration: runtime.read,
  readProtectedPrivacyIdentity: runtime.identity,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace() {}, refresh() {} }),
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
  animate: vi.fn((_node, _target, options) => {
    const cancel = vi.fn();
    runtime.stops.push(cancel);
    runtime.updates.push(options.onUpdate);
    return { cancel };
  }),
}));
const binding = {
  actorId: 'staff',
  backend: 'https://preview.example',
  role: 'staff' as const,
  canManageConfiguration: true,
};
let frames: Map<number, FrameRequestCallback>,
  serial = 0;
let controls: {
  command: ReturnType<typeof useRouteCommandBoundary>;
  close: () => void;
};
function Business() {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLButtonElement>(null);
  const feedback = useTransientFeedbackOwner(host);
  const command = useRouteCommandBoundary(binding.actorId, binding.backend);
  const operation = useRef(0);
  useLayoutEffect(() => {
    controls = { command, close: () => setOpen(false) };
  });
  return (
    <section>
      <input aria-label="Underlying draft" />
      <button onClick={() => setOpen(true)}>Open surface</button>
      <button
        ref={host}
        onClick={() => {
          const id = String(++operation.current);
          feedback.confirm(feedback.begin(id), id, {
            kind: 'details-saved',
            eventId: id,
          });
        }}
      >
        Confirmed operation
      </button>
      <SpringPresence
        open={open}
        instanceKey="original"
        kind="popover"
        retainExit
      >
        <button>Private surface</button>
      </SpringPresence>
    </section>
  );
}
function tree(owner = binding) {
  return (
    <ProtectedPrivacyBoundary
      serverGeneration={{ status: 'absent' }}
      binding={owner}
    >
      <MotionPreference>
        <RouteMotionProvider actorId={owner.actorId}>
          <ProtectedPrivacyContent>
            <TransientFeedbackProvider
              actorId={owner.actorId}
              backend={owner.backend}
            >
              <RouteReady
                actorId={owner.actorId}
                routeKey="/inventory"
                contentIdentity="spring-primary"
                conventionalPrimary
              >
                <Business />
              </RouteReady>
            </TransientFeedbackProvider>
          </ProtectedPrivacyContent>
        </RouteMotionProvider>
      </MotionPreference>
    </ProtectedPrivacyBoundary>
  );
}
beforeEach(() => {
  frames = new Map();
  serial = 0;
  runtime.updates = [];
  runtime.stops = [];
  vi.mocked(animate).mockClear();
  sessionStorage.clear();
  localStorage.clear();
  runtime.read.mockReset().mockResolvedValue({ status: 'absent' });
  runtime.identity
    .mockReset()
    .mockResolvedValue({ status: 'match', generation: { status: 'absent' } });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 120, 32),
  ] as unknown as DOMRectList);
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('navigation', new EventTarget());
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
  document.documentElement.dataset.motion = 'full';
  history.replaceState({}, '', '/inventory');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'animate');
  history.replaceState({}, '', '/');
});

it('performs zero decorative preference reads before actual protected admission', async () => {
  let release!: (value: LogoutPrivacyGeneration) => void;
  runtime.read.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const get = vi.spyOn(Storage.prototype, 'getItem');
  render(
    <ProtectedPrivacyBoundary
      serverGeneration={{ status: 'absent' }}
      binding={binding}
    >
      <SpringDisclosure summary="Native disclosure">
        <input aria-label="Native draft" />
      </SpringDisclosure>
      <SpringPresence open instanceKey="placeholder" kind="panel">
        Static parent-owned content
      </SpringPresence>
    </ProtectedPrivacyBoundary>,
  );
  expect(
    get.mock.calls.filter(([key]) => key === 'it-inventory-reduce-motion'),
  ).toHaveLength(0);
  expect(animate).not.toHaveBeenCalled();
  await act(async () => release({ status: 'absent' }));
  expect(animate).not.toHaveBeenCalled(); // No existing route owner to lend animation admission.
});
it.each(['forbidden', 'actor_changed'] as const)(
  'removes private exit and notices on current terminal %s without changing business ownership',
  async (code) => {
    const view = render(tree());
    await screen.findByRole('textbox');
    await waitFor(() => expect(controls.command.authorized()).toBe(true));
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'retained' } });
    const command = controls.command.capture(),
      epoch = assignmentEpoch(),
      revision = readPrivacyRevocationRevision();
    fireEvent.click(screen.getByText('Open surface'));
    fireEvent.click(screen.getByText('Confirmed operation'));
    expect(animate).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Details saved.');
    const original = screen.getByText('Private surface');
    act(() => controls.close());
    expect(original.isConnected).toBe(true);
    expect(original.closest('[data-spring-presence]')).toHaveAttribute('inert');
    const oldFrames = [...frames.values()],
      oldUpdates = [...runtime.updates];
    await act(async () => {
      await observeRouteActionResult(Promise.resolve({ ok: false, code }));
    });
    expect(original.isConnected).toBe(false);
    expect(view.container.querySelector('[data-feedback-card]')).toBeNull();
    expect(runtime.stops.every((stop) => stop.mock.calls.length > 0)).toBe(
      true,
    );
    vi.mocked(animate).mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      oldFrames.forEach((callback) => callback(100));
      oldUpdates.forEach((callback) => callback());
    });
    expect(animate).not.toHaveBeenCalled();
    expect(draft).toHaveValue('retained');
    expect(screen.getByRole('textbox')).toBe(draft);
    // Existing terminal denial also retires command admission; decoration must
    // not revive that business owner while the ordinary draft stays mounted.
    expect(command()).toBe(false);
    expect(assignmentEpoch()).toBe(epoch);
    expect(readPrivacyRevocationRevision()).toBe(revision);
  },
);
it('retires an original actor/backend exit across a protected binding replacement and released callbacks', async () => {
  const view = render(tree());
  await screen.findByRole('textbox');
  await waitFor(() => expect(controls.command.authorized()).toBe(true));
  fireEvent.click(screen.getByText('Open surface'));
  fireEvent.click(screen.getByText('Confirmed operation'));
  const oldFrames = [...frames.values()],
    oldUpdates = [...runtime.updates];
  act(() => controls.close());
  view.rerender(tree({ ...binding, backend: 'https://other.example' }));
  expect(view.container.querySelector('[data-feedback-card]')).toBeNull();
  expect(
    view.container.querySelector('[data-spring-state="exiting"]'),
  ).toBeNull();
  vi.mocked(animate).mockClear();
  act(() => {
    oldFrames.forEach((callback) => callback(100));
    oldUpdates.forEach((callback) => callback());
  });
  expect(animate).not.toHaveBeenCalled();
});
