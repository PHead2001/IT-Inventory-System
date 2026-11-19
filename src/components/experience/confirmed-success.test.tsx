import { animate } from 'motion/mini';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import {
  AddedBump,
  ConfirmedPulse,
  ConfirmedSuccess,
  createFeedbackOwner,
} from './confirmed-success';

let frames: Map<number, FrameRequestCallback>,
  frameId = 0;
function flushFrame(time = 30) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  });
}
const stops = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock('motion/mini', () => ({
  animate: vi.fn(() => {
    const cancel = vi.fn();
    stops.push(cancel);
    return { cancel };
  }),
}));
const grant = () => ({
  ready: true,
  visible: true,
  generation: 'success-test',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function Managed({ children }: { children: React.ReactNode }) {
  return (
    <PrivacyReadinessContext value={grant()}>
      {children}
    </PrivacyReadinessContext>
  );
}
beforeEach(() => {
  vi.mocked(animate).mockClear();
  stops.length = 0;
  frames = new Map();
  frameId = 0;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (
    this: Element,
  ) {
    if (getComputedStyle(this).display === 'none')
      return [] as unknown as DOMRectList;
    for (let node = this.parentElement; node; node = node.parentElement)
      if (getComputedStyle(node).display === 'none')
        return [] as unknown as DOMRectList;
    return [new DOMRect(10, 20, 120, 30)] as unknown as DOMRectList;
  });
  localStorage.clear();
  document.documentElement.dataset.motion = 'full';
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'animate');
});
it('draws the two actual SVG stroke segments sequentially within 250ms and never announces decoration', () => {
  const view = render(
    <Managed>
      <ConfirmedSuccess eventId="committed-1" />
    </Managed>,
  );
  expect(animate).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(animate).mock.calls;
  expect(calls[0][0]).toHaveAttribute('data-success-stroke');
  expect(calls[0][1]).toEqual({ transform: ['scaleX(0)', 'scaleX(1)'] });
  expect(calls[0][2]).toEqual({ duration: 0.08, delay: 0 });
  expect(calls[1][2]).toEqual({ duration: 0.14, delay: 0.08 });
  expect(view.container.querySelector('svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  expect(view.container.querySelector('[role], [aria-live]')).toBeNull();
});
it('claims only the exact result once through rerenders and receipt detail replacement', () => {
  const owner = createFeedbackOwner();
  const tree = (id: string) => (
    <Managed>
      <ConfirmedSuccess owner={owner} eventId={id} />
    </Managed>
  );
  const view = render(tree('A'));
  view.rerender(tree('A'));
  expect(animate).toHaveBeenCalledTimes(2);
  view.unmount();
  render(tree('A'));
  expect(animate).toHaveBeenCalledTimes(2);
  render(tree('B'));
  expect(animate).toHaveBeenCalledTimes(4);
});
it('renders restored receipts statically and gives no success for no-op or absent committed IDs', () => {
  const view = render(
    <Managed>
      <ConfirmedSuccess eventId="old" restored />
      <ConfirmedSuccess eventId="noop" changed={false} />
      <ConfirmedSuccess />
    </Managed>,
  );
  expect(animate).not.toHaveBeenCalled();
  expect(
    view.container.querySelectorAll('[data-confirmed-success]'),
  ).toHaveLength(1);
});
it('consumes Reduced results with final graphics/text immediately and never replays on Full', () => {
  document.documentElement.dataset.motion = 'reduced';
  const owner = createFeedbackOwner();
  const tree = () => (
    <Managed>
      <ConfirmedSuccess owner={owner} eventId="A" />
      <AddedBump additionId="B">4 labels</AddedBump>
    </Managed>
  );
  const view = render(tree());
  expect(animate).not.toHaveBeenCalled();
  expect(view.container).toHaveTextContent('4 labels');
  document.documentElement.dataset.motion = 'full';
  view.rerender(tree());
  expect(animate).not.toHaveBeenCalled();
});
it.each(['hidden', 'inert'] as const)(
  'does not replay a result initially in a %s host',
  async (attribute) => {
    const owner = createFeedbackOwner();
    const tree = (hidden: boolean) => (
      <Managed>
        <div {...(hidden ? { [attribute]: true } : {})}>
          <ConfirmedSuccess owner={owner} eventId="A" />
        </div>
      </Managed>
    );
    const view = render(tree(true));
    expect(animate).not.toHaveBeenCalled();
    view.rerender(tree(false));
    await act(async () => {});
    expect(animate).not.toHaveBeenCalled();
  },
);
it.each(['revocation', 'assignment'] as const)(
  'withdraws active effects immediately on %s without changing authority',
  (kind) => {
    const view = render(
      <Managed>
        <ConfirmedSuccess eventId="A" />
        <ConfirmedPulse eventId="A" />
      </Managed>,
    );
    expect(animate).toHaveBeenCalledTimes(3);
    act(() => {
      if (kind === 'revocation') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
    });
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    view.rerender(
      <Managed>
        <ConfirmedSuccess eventId="A" />
        <ConfirmedPulse eventId="A" />
      </Managed>,
    );
    expect(animate).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  },
);
it('uses 140ms opacity-only pulses and transform-only counter bumps with immediate final values', () => {
  const view = render(
    <Managed>
      <ConfirmedPulse eventId="A" />
      <AddedBump additionId="B">12 labels</AddedBump>
    </Managed>,
  );
  expect(animate).toHaveBeenCalledTimes(2);
  expect(vi.mocked(animate).mock.calls[0].slice(1)).toEqual([
    { opacity: [0, 0.65, 0] },
    { duration: 0.14, delay: 0 },
  ]);
  expect(view.container).toHaveTextContent('12 labels');
});
it('cancels on document hiding and never replays that receipt after visibility returns', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  const view = render(
    <Managed>
      <ConfirmedSuccess eventId="A" />
    </Managed>,
  );
  act(() => {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  act(() => {
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  view.rerender(
    <Managed>
      <ConfirmedSuccess eventId="A" />
    </Managed>,
  );
  expect(animate).toHaveBeenCalledTimes(2);
});
it('consumes live canonical Reduced changes, cancels immediately and never restarts the old confirmation', () => {
  const view = render(
    <Managed>
      <ConfirmedSuccess eventId="A" />
    </Managed>,
  );
  act(() => {
    localStorage.setItem('it-inventory-reduce-motion', 'true');
    window.dispatchEvent(new Event('it-inventory-motion-change'));
  });
  expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  act(() => {
    localStorage.setItem('it-inventory-reduce-motion', 'false');
    document.documentElement.dataset.motion = 'full';
    window.dispatchEvent(new Event('it-inventory-motion-change'));
  });
  expect(animate).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});

it.each(['display', 'visibility'])(
  'suppresses CSS %s hidden strokes, pulse and bump on the actual rendered elements',
  (mode) => {
    const owner = createFeedbackOwner();
    const tree = (hidden: boolean) => (
      <Managed>
        <div
          style={
            hidden
              ? mode === 'display'
                ? { display: 'none' }
                : { visibility: 'hidden' }
              : undefined
          }
        >
          <ConfirmedSuccess owner={owner} eventId="hidden-confirmation" />
          <ConfirmedPulse owner={owner} eventId="hidden-confirmation" />
          <AddedBump owner={owner} additionId="hidden-addition">
            9 labels
          </AddedBump>
        </div>
      </Managed>
    );
    const view = render(tree(true));
    expect(animate).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    view.rerender(tree(false));
    expect(animate).not.toHaveBeenCalled();
    expect(view.container).toHaveTextContent('9 labels');
    expect(
      view.container.querySelector('[data-confirmed-success]'),
    ).toBeInTheDocument();
  },
);
it('finishes real stroke/pulse/bump targets when a responsive ancestor hides and ignores their retired frames', () => {
  const owner = createFeedbackOwner();
  const tree = (id: string) => (
    <Managed>
      <div data-responsive-owner>
        <ConfirmedSuccess owner={owner} eventId={id} />
        <ConfirmedPulse owner={owner} eventId={id} />
        <AddedBump owner={owner} additionId={id}>
          9 labels
        </AddedBump>
      </div>
    </Managed>
  );
  const view = render(tree('first'));
  expect(animate).toHaveBeenCalledTimes(4);
  const retired = [...frames.values()];
  const ancestor = view.container.querySelector<HTMLElement>(
    '[data-responsive-owner]',
  )!;
  ancestor.style.visibility = 'hidden';
  flushFrame();
  expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  expect(frames.size).toBe(0);
  ancestor.style.visibility = 'visible';
  view.rerender(tree('first'));
  expect(animate).toHaveBeenCalledTimes(4);
  view.rerender(tree('next'));
  expect(animate).toHaveBeenCalledTimes(8);
  const current = stops.slice(4);
  act(() => retired.forEach((callback) => callback(50)));
  expect(current.every((stop) => stop.mock.calls.length === 0)).toBe(true);
  view.unmount();
  expect(current.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});
