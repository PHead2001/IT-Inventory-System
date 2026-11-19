import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import { ListEntrance } from './list-feedback';
import { LocationBrowser } from '@/features/room/location-browser';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import { CountTicker, integerCount, interpolateCount } from './count-ticker';
const motion = vi.hoisted(() => ({ stops: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('motion/mini', () => ({
  animate: vi.fn(() => {
    const cancel = vi.fn();
    motion.stops.push(cancel);
    return { cancel };
  }),
}));
import { animate } from 'motion/mini';
let frames: Map<number, FrameRequestCallback>,
  serial = 0,
  hidden = false,
  osReduced = false;
const mediaListeners = new Set<() => void>();
const fresh = () => ({
  ready: true,
  visible: true,
  generation: 'member-a',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
function managed(ui: React.ReactNode, grant = fresh()) {
  return <PrivacyReadinessContext value={grant}>{ui}</PrivacyReadinessContext>;
}
function paint(time: number) {
  const pending = [...frames];
  frames.clear();
  act(() => pending.forEach(([, callback]) => callback(time)));
}
function list(ids: string[], pending = false) {
  return (
    <ListEntrance identities={ids} pending={pending}>
      {ids.map((id) => (
        <li key={id} data-testid={id}>
          {id}
        </li>
      ))}
    </ListEntrance>
  );
}
const visual = (root: HTMLElement) =>
  root.querySelector('[data-count-visual]')!;
beforeEach(() => {
  frames = new Map();
  serial = 0;
  hidden = false;
  osReduced = false;
  mediaListeners.clear();
  motion.stops = [];
  vi.mocked(animate).mockClear();
  document.documentElement.dataset.motion = 'full';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible',
  );
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (
    this: Element,
  ) {
    return this.closest('[data-no-rects]')
      ? ([] as unknown as DOMRectList)
      : ([new DOMRect(0, 0, 120, 32)] as unknown as DOMRectList);
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return osReduced;
    },
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) =>
      mediaListeners.delete(fn),
  }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'animate');
});
it('bounds actual first-screen scheduling and animates only newly entering stable rows', () => {
  const ids = Array.from({ length: 24 }, (_, i) => 'row-' + i);
  const view = render(managed(list(ids)));
  const calls = vi.mocked(animate).mock.calls;
  expect(calls).toHaveLength(10);
  expect(
    calls.map((call) => (call[0] as Element).getAttribute('data-testid')),
  ).toEqual(ids.slice(0, 10));
  expect(
    Math.max(
      ...calls.map(
        (call) =>
          (call[2] as { duration: number; delay: number }).duration +
          (call[2] as { delay: number }).delay,
      ),
    ),
  ).toBeLessThan(0.4);
  expect(calls.map((call) => (call[2] as { delay: number }).delay)).toEqual(
    [...calls].map((_, i) => i * 0.03),
  );
  vi.mocked(animate).mockClear();
  view.rerender(managed(list(['row-4', 'row-2', 'new'])));
  expect(animate).toHaveBeenCalledTimes(1);
  expect(vi.mocked(animate).mock.calls[0][0]).toBe(screen.getByTestId('new'));
  vi.mocked(animate).mockClear();
  view.rerender(managed(list(['new', 'row-2', 'row-4'])));
  expect(animate).not.toHaveBeenCalled();
  view.rerender(managed(list([...ids.slice(0, 10), 'offscreen'])));
  expect(
    vi
      .mocked(animate)
      .mock.calls.every(
        (call) =>
          (call[0] as Element).getAttribute('data-testid') !== 'offscreen',
      ),
  ).toBe(true);
});
it('keeps completed identities through transient pending work and reveals expanded children only', () => {
  const view = render(managed(list(['parent'])));
  vi.mocked(animate).mockClear();
  view.rerender(managed(list(['parent'], true)));
  expect(animate).not.toHaveBeenCalled();
  view.rerender(managed(list(['parent', 'child'])));
  expect(animate).toHaveBeenCalledTimes(1);
  expect(vi.mocked(animate).mock.calls[0][0]).toBe(screen.getByTestId('child'));
});
it('keeps exact BigInt interpolation and refuses unsafe numeric inputs', () => {
  const from = 900719925474099300000n,
    to = from + 100000000000000000001n;
  expect(integerCount(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  expect(integerCount('1.2')).toBeNull();
  expect(integerCount(String(from))).toBe(from);
  expect(interpolateCount(from, to, 0)).toBe(from);
  expect(interpolateCount(from, to, 1)).toBe(to);
  expect(interpolateCount(to, from, 1)).toBe(from);
  expect(interpolateCount(from, to, 2)).toBe(to);
});
it('starts ordinary counts at their final value, exposes only final AT text and reaches huge changed endpoints exactly', () => {
  const a = '900719925474099300001',
    b = '900719925474099399999';
  const view = render(managed(<CountTicker value={a} unit="unit" />));
  expect(frames.size).toBe(0);
  view.rerender(managed(<CountTicker value={b} unit="unit" />));
  expect(view.container.querySelector('[data-count-final]')).toHaveTextContent(
    b + ' units',
  );
  expect(visual(view.container)).toHaveAttribute('aria-hidden', 'true');
  paint(250);
  expect(visual(view.container).textContent).not.toBe(b + ' units');
  expect(view.container.querySelector('[data-count-final]')).toHaveTextContent(
    b + ' units',
  );
  paint(500);
  expect(visual(view.container)).toHaveTextContent(b + ' units');
  expect(frames.size).toBe(0);
});
it('Overview opt-in alone begins at zero, while server-rendered content is final and safe', () => {
  const markup = renderToString(
    <CountTicker value="99999999999999999999" initialZero />,
  );
  expect(markup).toContain('99999999999999999999');
  const view = render(
    managed(<CountTicker value="99999999999999999999" initialZero />),
  );
  paint(0);
  expect(visual(view.container)).toHaveTextContent(/^0$/);
  paint(500);
  expect(visual(view.container)).toHaveTextContent('99999999999999999999');
});
it.each(['revocation', 'invalidation'] as const)(
  'cancels %s synchronously, clears comparison state and rejects obsolete callbacks',
  (kind) => {
    const view = render(managed(<CountTicker value="90" initialZero />));
    paint(100);
    const old = [...frames.values()][0];
    act(() => {
      if (kind === 'revocation') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
      expect(frames.size).toBe(0);
    });
    expect(visual(view.container)).toHaveTextContent(/^90$/);
    view.rerender(managed(<CountTicker value="120" />));
    expect(frames.size).toBe(0);
    act(() => old?.(300));
    expect(visual(view.container)).toHaveTextContent(/^120$/);
    view.rerender(managed(<CountTicker value="125" />));
    expect(frames.size).toBe(1);
    paint(500);
    expect(visual(view.container)).toHaveTextContent(/^125$/);
  },
);
it.each([
  'unmanaged',
  'missing-epoch',
  'missing-revision',
  'stale-epoch',
  'stale-revision',
  'not-ready',
  'not-visible',
] as const)('never admits %s retained feedback', (kind) => {
  const grant: ReturnType<typeof fresh> & {
    verifiedEpoch?: number;
    revocationRevision?: number;
  } = fresh();
  if (kind === 'unmanaged') grant.generation = 'unmanaged';
  if (kind === 'missing-epoch') Reflect.deleteProperty(grant, 'verifiedEpoch');
  if (kind === 'missing-revision')
    Reflect.deleteProperty(grant, 'revocationRevision');
  if (kind === 'stale-epoch') grant.verifiedEpoch--;
  if (kind === 'stale-revision') grant.revocationRevision--;
  if (kind === 'not-ready') grant.ready = false;
  if (kind === 'not-visible') grant.visible = false;
  const view = render(
    managed(
      <>
        <CountTicker value="90" initialZero />
        {list(['private'])}
      </>,
      grant,
    ),
  );
  expect(frames.size).toBe(0);
  expect(animate).not.toHaveBeenCalled();
  expect(visual(view.container)).toHaveTextContent(/^90$/);
});
it('cancels Reduced motion immediately, resumes statically and only animates a later confirmed change', async () => {
  const view = render(
    managed(
      <>
        <CountTicker value="90" initialZero />
        {list(['a'])}
      </>,
    ),
  );
  paint(100);
  osReduced = true;
  act(() => mediaListeners.forEach((fn) => fn()));
  expect(frames.size).toBe(0);
  expect(motion.stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
  expect(visual(view.container)).toHaveTextContent(/^90$/);
  osReduced = false;
  act(() => mediaListeners.forEach((fn) => fn()));
  expect(frames.size).toBe(0);
  view.rerender(
    managed(
      <>
        <CountTicker value="100" />
        {list(['a', 'b'])}
      </>,
    ),
  );
  expect(frames.size).toBe(2);
  document.documentElement.dataset.motion = 'reduced';
  await act(async () => {});
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toHaveTextContent(/^100$/);
});
it.each(['hidden', 'inert', 'closed-details'] as const)(
  'withdraws %s ancestry and never replays a retained visit',
  async (kind) => {
    const content = (
      <>
        <CountTicker value="70" initialZero />
        {list(['row'])}
      </>
    );
    const view = render(managed(<details open>{content}</details>));
    const host = view.container.querySelector('details')!;
    const before = motion.stops.slice();
    if (kind === 'closed-details') host.open = false;
    else host.setAttribute(kind, '');
    await act(async () => {});
    expect(frames.size).toBe(0);
    expect(before.every((stop) => stop.mock.calls.length > 0)).toBe(true);
    vi.mocked(animate).mockClear();
    if (kind === 'closed-details') host.open = true;
    else host.removeAttribute(kind);
    await act(async () => {});
    expect(frames.size).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  },
);
it('checks tab visibility before a queued write and cancels after detachment or unmount', async () => {
  const view = render(managed(<CountTicker value="80" initialZero />));
  paint(100);
  hidden = true;
  paint(200);
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toHaveTextContent(/^80$/);
  hidden = false;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(frames.size).toBe(0);
  view.rerender(managed(<CountTicker value="90" />));
  expect(frames.size).toBe(1);
  view.container.remove();
  await act(async () => {});
  expect(frames.size).toBe(0);
  view.unmount();
});
it('seeds a changed actor generation without tweening an older account value', () => {
  const first = fresh();
  const view = render(managed(<CountTicker value="100" initialZero />, first));
  paint(100);
  const obsolete = [...frames.values()][0];
  view.rerender(
    managed(<CountTicker value="600" />, {
      ...fresh(),
      generation: 'member-b',
    }),
  );
  expect(frames.size).toBe(0);
  act(() => obsolete?.(400));
  expect(visual(view.container)).toHaveTextContent(/^600$/);
  view.rerender(
    managed(<CountTicker value="700" />, {
      ...fresh(),
      generation: 'member-b',
    }),
  );
  expect(frames.size).toBe(1);
});
it('keeps repeated blocked value commits bounded and retires private prior footprints', () => {
  const grant = fresh();
  grant.ready = false;
  const view = render(managed(<CountTicker value="1" />, grant));
  for (let i = 2; i < 20; i++)
    view.rerender(managed(<CountTicker value={String(i)} />, grant));
  expect(frames.size).toBe(0);
  expect(
    [...view.container.querySelectorAll('[data-count-footprint]')].every(
      (element) => element.textContent === '19',
    ),
  ).toBe(true);
});

it('uses rendered source desktop/mobile copies, cancels on resize and only animates newly expanded visible rows', () => {
  let width = 1280;
  vi.mocked(Element.prototype.getClientRects).mockImplementation(function (
    this: Element,
  ) {
    if (this.closest('ul')?.classList.contains('md:hidden') && width >= 768)
      return [] as unknown as DOMRectList;
    if (this.closest('ul')?.classList.contains('md:block') && width < 768)
      return [] as unknown as DOMRectList;
    return [new DOMRect(0, 0, 320, 44)] as unknown as DOMRectList;
  });
  const root: LocationRef = {
    id: 'root',
    code: 'ITC',
    name: 'IT Closet',
    breadcrumb: 'IT Closet',
    parentId: null,
    active: true,
    can_hold_inventory: false,
  };
  const child: LocationRef = {
    ...root,
    id: 'child',
    code: 'ITC-S1A',
    name: 'Shelf 1A',
    breadcrumb: 'IT Closet / Shelf 1A',
    parentId: 'root',
    can_hold_inventory: true,
  };
  const view = render(
    managed(
      <LocationBrowser
        locations={[root, child]}
        selectedCode={null}
        onSelect={vi.fn()}
      />,
    ),
  );
  expect(animate).toHaveBeenCalledTimes(1);
  expect(
    (vi.mocked(animate).mock.calls[0][0] as Element).closest('ul'),
  ).toHaveClass('md:block');
  const stop = motion.stops[0];
  vi.mocked(animate).mockClear();
  width = 390;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(stop).toHaveBeenCalled();
  expect(frames.size).toBe(0);
  expect(animate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open IT Closet' }));
  expect(animate).toHaveBeenCalledTimes(1);
  expect(
    (vi.mocked(animate).mock.calls[0][0] as Element).closest('ul'),
  ).toHaveClass('md:hidden');
  expect(view.container.querySelectorAll('ul')).toHaveLength(2);
});
it('commits final values without layout, snaps an owned frame when CSS hides it, and readmits without replay', () => {
  const view = render(
    managed(
      <div data-no-rects>
        <CountTicker value="70" initialZero />
      </div>,
    ),
  );
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toHaveTextContent(/^70$/);
  view.container.firstElementChild!.removeAttribute('data-no-rects');
  act(() => window.dispatchEvent(new Event('resize')));
  expect(frames.size).toBe(0);
  view.rerender(
    managed(
      <div>
        <CountTicker value="90" />
      </div>,
    ),
  );
  expect(frames.size).toBe(1);
  const late = [...frames.values()][0];
  view.container.firstElementChild!.setAttribute('data-no-rects', '');
  paint(100);
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toHaveTextContent(/^90$/);
  view.container.firstElementChild!.removeAttribute('data-no-rects');
  act(() => window.dispatchEvent(new Event('resize')));
  act(() => late?.(300));
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toHaveTextContent(/^90$/);
});
it('stops a native child animation when its own geometry becomes hidden and respects computed visibility', async () => {
  const view = render(managed(list(['a', 'b'])));
  const first = motion.stops[0],
    second = motion.stops[1];
  screen.getByTestId('a').setAttribute('data-no-rects', '');
  paint(50);
  expect(first).toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  paint(500);
  expect(frames.size).toBe(0);
  expect(second).toHaveBeenCalled();
  view.rerender(
    managed(
      <div style={{ visibility: 'hidden' }}>
        {list(['x'])}
        <CountTicker value="20" initialZero />
      </div>,
    ),
  );
  vi.mocked(animate).mockClear();
  await act(async () => {});
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toHaveTextContent(/^20$/);
});
