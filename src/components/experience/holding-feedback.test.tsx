import { animate } from 'motion/mini';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import {
  HoldingFeedback,
  HoldingSnapshotList,
  HoldingPulseGraphic,
} from './holding-feedback';
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
  generation: 'holdings',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
const tree = (rows: { id: string; value: string }[], hidden = false) => (
  <PrivacyReadinessContext value={grant()}>
    <div hidden={hidden}>
      <HoldingFeedback
        rows={rows.map((row) => ({
          ...row,
          content: (
            <span>
              {row.id}: {row.value} units
            </span>
          ),
        }))}
      />
    </div>
  </PrivacyReadinessContext>
);
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
it('starts silently, matches endpoints through reordering, and pulses only changed canonical values', () => {
  const rows = [
    { id: 'storage:A', value: '5' },
    { id: 'site:B', value: '8' },
  ];
  const view = render(tree(rows));
  expect(animate).not.toHaveBeenCalled();
  view.rerender(tree([...rows].reverse()));
  expect(animate).not.toHaveBeenCalled();
  view.rerender(tree([{ id: 'site:B', value: '9' }, rows[0]]));
  expect(animate).toHaveBeenCalledOnce();
  expect(
    (vi.mocked(animate).mock.calls[0][0] as Element).parentElement,
  ).toHaveTextContent('site:B: 9 units');
  expect(
    view.container.querySelector(
      '[data-confirmed-success], [aria-live], [role="status"]',
    ),
  ).toBeNull();
});
it('uses a fresh baseline after hidden withdrawal and cancels old presentation on revocation/unmount', async () => {
  const view = render(tree([{ id: 'A', value: '1' }]));
  view.rerender(tree([{ id: 'A', value: '2' }]));
  expect(animate).toHaveBeenCalledOnce();
  view.rerender(tree([{ id: 'A', value: '3' }], true));
  await act(async () => {});
  expect(stops[0]).toHaveBeenCalledOnce();
  view.rerender(tree([{ id: 'A', value: '3' }]));
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(tree([{ id: 'A', value: '4' }]));
  expect(animate).toHaveBeenCalledTimes(2);
  view.rerender(tree([{ id: 'A', value: '5' }]));
  expect(animate).toHaveBeenCalledTimes(3);
  act(() => revokePrivatePresentation());
  expect(stops[1]).toHaveBeenCalledOnce();
  expect(stops[2]).toHaveBeenCalledOnce();
  view.unmount();
  expect(stops[1]).toHaveBeenCalledOnce();
  expect(stops[2]).toHaveBeenCalledOnce();
});
it('reseeds on tab visibility readmission without replaying hidden snapshots or missing the next change', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  const view = render(tree([{ id: 'A', value: '1' }]));
  view.rerender(tree([{ id: 'A', value: '2' }]));
  expect(animate).toHaveBeenCalledOnce();
  act(() => {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(stops[0]).toHaveBeenCalledOnce();
  view.rerender(tree([{ id: 'A', value: '3' }]));
  act(() => {
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(animate).toHaveBeenCalledOnce();
  view.rerender(tree([{ id: 'A', value: '4' }]));
  expect(animate).toHaveBeenCalledTimes(2);
});
it('reseeds only after the supplied verified privacy context readmits the unchanged canonical snapshot', () => {
  const context = grant();
  const workspace = (value: string, ready: boolean, verified = context) => (
    <PrivacyReadinessContext value={{ ...verified, ready, visible: ready }}>
      <HoldingFeedback
        rows={[{ id: 'A', value, content: <span>{value} units</span> }]}
      />
    </PrivacyReadinessContext>
  );
  const view = render(workspace('1', true));
  view.rerender(workspace('2', true));
  expect(animate).toHaveBeenCalledOnce();
  view.rerender(workspace('3', false));
  expect(stops[0]).toHaveBeenCalledOnce();
  view.rerender(workspace('3', true));
  expect(animate).toHaveBeenCalledOnce();
  view.rerender(workspace('4', true));
  expect(animate).toHaveBeenCalledTimes(2);
  act(() => revokePrivatePresentation());
  expect(stops[1]).toHaveBeenCalledOnce();
  // An old ready=true context cannot supply new authority after revocation.
  view.rerender(workspace('5', true));
  expect(animate).toHaveBeenCalledTimes(2);
  // The owner supplies a fresh verified context; the presentation helper never creates one.
  const fresh = grant();
  view.rerender(workspace('5', true, fresh));
  expect(animate).toHaveBeenCalledTimes(2);
  view.rerender(workspace('6', true, fresh));
  expect(animate).toHaveBeenCalledTimes(3);
});
it('retains exact immediate final values and consumes Reduced snapshot changes without replay', () => {
  const view = render(tree([{ id: 'A', value: '1' }]));
  document.documentElement.dataset.motion = 'reduced';
  view.rerender(tree([{ id: 'A', value: '2' }]));
  expect(view.container).toHaveTextContent('A: 2 units');
  expect(animate).not.toHaveBeenCalled();
  document.documentElement.dataset.motion = 'full';
  view.rerender(tree([{ id: 'A', value: '2' }]));
  expect(animate).not.toHaveBeenCalled();
});
it('bounds new endpoint pulses after an accepted initial baseline to 140ms', () => {
  const view = render(tree([{ id: 'A', value: '1' }]));
  view.rerender(
    tree([
      { id: 'A', value: '1' },
      { id: 'B', value: '3' },
    ]),
  );
  expect(animate).toHaveBeenCalledOnce();
  expect(vi.mocked(animate).mock.calls[0][2]).toEqual({ duration: 0.14 });
  view.unmount();
  expect(stops[0]).toHaveBeenCalledOnce();
});
it('cannot attribute ambiguous repeated endpoint IDs and reseeds instead of pulsing', () => {
  const list = (snapshot: { id: string; value: string }[]) => (
    <PrivacyReadinessContext value={grant()}>
      <HoldingSnapshotList snapshot={snapshot}>
        {snapshot.map((row, index) => (
          <li key={index}>
            <HoldingPulseGraphic />
            {row.value}
          </li>
        ))}
      </HoldingSnapshotList>
    </PrivacyReadinessContext>
  );
  const view = render(list([{ id: 'A', value: '1' }]));
  view.rerender(
    list([
      { id: 'A', value: '2' },
      { id: 'A', value: '3' },
    ]),
  );
  view.rerender(list([{ id: 'A', value: '4' }]));
  expect(animate).not.toHaveBeenCalled();
});

it.each(['display', 'visibility'])(
  'suppresses CSS %s hidden holdings without replay or swallowing the next canonical change',
  (mode) => {
    const tree = (value: string, hidden: boolean) => (
      <PrivacyReadinessContext value={grant()}>
        <div
          style={
            hidden
              ? mode === 'display'
                ? { display: 'none' }
                : { visibility: 'hidden' }
              : undefined
          }
        >
          <HoldingFeedback
            rows={[
              { id: 'holding', value, content: <span>{value} units</span> },
            ]}
          />
        </div>
      </PrivacyReadinessContext>
    );
    const view = render(tree('1', true));
    view.rerender(tree('2', true));
    expect(animate).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    view.rerender(tree('2', false));
    expect(animate).not.toHaveBeenCalled();
    view.rerender(tree('3', false));
    expect(animate).toHaveBeenCalledOnce();
    expect(vi.mocked(animate).mock.calls[0][0]).toHaveAttribute(
      'data-holding-pulse',
    );
  },
);
it('cancels only the actual holding pulse after responsive hiding and retires the saved frame', () => {
  const tree = (value: string) => (
    <PrivacyReadinessContext value={grant()}>
      <div data-responsive-owner>
        <HoldingFeedback
          rows={[{ id: 'holding', value, content: <span>{value} units</span> }]}
        />
      </div>
    </PrivacyReadinessContext>
  );
  const view = render(tree('1'));
  view.rerender(tree('2'));
  expect(animate).toHaveBeenCalledOnce();
  const retired = [...frames.values()];
  const ancestor = view.container.querySelector<HTMLElement>(
    '[data-responsive-owner]',
  )!;
  ancestor.style.display = 'none';
  flushFrame();
  expect(stops[0]).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  ancestor.style.display = 'block';
  view.rerender(tree('3'));
  expect(animate).toHaveBeenCalledTimes(2);
  act(() => retired.forEach((callback) => callback(50)));
  expect(stops[1]).not.toHaveBeenCalled();
  expect(view.container).toHaveTextContent('3 units');
});
