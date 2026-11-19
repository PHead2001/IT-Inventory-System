import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { occupancyText, type LocationOccupancy } from '../occupancy-contract';
import { RoomLabel } from './room-label';
import {
  createRoomLabelRegistry,
  LabelLayoutProvider,
} from './label-layout-runtime';

let frames: Map<number, FrameRequestCallback>, serial: number;
const cleanups = new Set<() => void>();
const occupancy = (units: string): LocationOccupancy => ({
  quantity_product_count: '1',
  quantity_unit_count: units,
  asset_count: '1',
});
const visual = (root: ParentNode) =>
  [...root.querySelectorAll('[data-count-visual]')]
    .map((element) => element.textContent)
    .join(' / ');
const final = (root: ParentNode) =>
  [...root.querySelectorAll('[data-count-final]')]
    .map((element) => element.textContent)
    .join(' / ');
async function paint(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(time)));
}
beforeEach(() => {
  frames = new Map();
  serial = 0;
  document.documentElement.dataset.motion = 'full';
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Deterministic painted boxes; these fixtures do not establish browser pixels.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (
    this: Element,
  ) {
    const hidden = (node: Element) =>
      node.hasAttribute('hidden') ||
      node.hasAttribute('inert') ||
      getComputedStyle(node).visibility === 'hidden' ||
      getComputedStyle(node).display === 'none';
    if (hidden(this)) return [] as unknown as DOMRectList;
    for (let node = this.parentElement; node; node = node.parentElement)
      if (hidden(node)) return [] as unknown as DOMRectList;
    return [new DOMRect(0, 0, 420, 44)] as unknown as DOMRectList;
  });
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  Reflect.deleteProperty(window, '__readRoomDemandSnapshot');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
    clock: () => 0,
  });
  const register = vi.spyOn(registry, 'register');
  const grant = {
    ready: true,
    visible: true,
    generation: 'room-count-member',
    verifiedEpoch: assignmentEpoch(),
    revocationRevision: readPrivacyRevocationRevision(),
  };
  const tree = (
    counts: LocationOccupancy | undefined,
    code: string | null = 'ITC-D07',
    id = 'drawer',
  ) => (
    <PrivacyReadinessContext value={grant}>
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id={id}
          code={code ?? undefined}
          label="Drawer 7"
          priority={3}
          selected
          occupancy={counts}
          onSelect={() => {}}
        />
      </LabelLayoutProvider>
    </PrivacyReadinessContext>
  );
  return { registry, register, tree };
}

it('keeps exact final accessibility and one registration while ticker frames change only visual counts', async () => {
  const f = fixture(),
    view = render(f.tree(occupancy('20')));
  expect(frames.size).toBe(0);
  expect(visual(view.container)).toBe(occupancyText(occupancy('20'), true));
  expect(f.register).toHaveBeenCalledOnce();
  view.rerender(f.tree(occupancy('60')));
  const expected = occupancyText(occupancy('60'), true);
  const button = screen.getByRole('button', {
    name: `Select Drawer 7 (ITC-D07); ${expected} at this location`,
  });
  expect(final(button)).toBe(expected);
  expect(f.register).toHaveBeenCalledTimes(2);
  expect(f.register.mock.lastCall?.[3].readableSummary).toBe(
    `Drawer 7 (ITC-D07) · ${expected}`,
  );
  await paint(250);
  expect(visual(button)).not.toBe(expected);
  expect(final(button)).toBe(expected);
  expect(f.register).toHaveBeenCalledTimes(2);
  await paint(500);
  expect(visual(button)).toBe(expected);
  expect(frames.size).toBe(0);
  expect(button.querySelector('[aria-live]')).toBeNull();
});

it('owns comparisons by canonical location, falls back to id, and unmounts unknown occupancy', () => {
  const f = fixture(),
    view = render(f.tree(occupancy('20')));
  const initial = view.container.querySelector('[data-count-visual]');
  view.rerender(f.tree(occupancy('60'), 'ITC-D07', 'new-dom-id'));
  expect(view.container.querySelector('[data-count-visual]')).toBe(initial);
  view.rerender(f.tree(occupancy('70'), 'ITC-D01'));
  expect(view.container.querySelector('[data-count-visual]')).not.toBe(initial);
  expect(frames.size).toBe(0);
  view.rerender(f.tree(undefined, 'ITC-D01'));
  expect(view.container.querySelector('[data-count-final]')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Select Drawer 7 (ITC-D01)' }),
  ).toHaveTextContent(/^Drawer 7$/);
  view.rerender(f.tree(occupancy('80'), 'ITC-D01'));
  expect(frames.size).toBe(0);
  view.rerender(f.tree(occupancy('80'), null, 'fallback-a'));
  const fallback = view.container.querySelector('[data-count-visual]');
  view.rerender(f.tree(occupancy('90'), null, 'fallback-b'));
  expect(view.container.querySelector('[data-count-visual]')).not.toBe(
    fallback,
  );
  expect(frames.size).toBe(0);
});

it.each(['compact', 'suppressed', 'occluded'] as const)(
  'inherits %s label withdrawal and reseeds instead of replaying after visibility returns',
  async (kind) => {
    const f = fixture(),
      view = render(f.tree(occupancy('20')));
    view.rerender(f.tree(occupancy('60')));
    const stale = [...frames.values()];
    const full = view.container.querySelector<HTMLElement>(
      '[data-room-label-full]',
    )!;
    const button = screen.getByRole('button');
    const anchor = view.container.firstElementChild as HTMLElement;
    const sheet = document.createElement('style');
    sheet.textContent = '.test-count-concealed { visibility: hidden; }';
    document.head.append(sheet);
    cleanups.add(() => sheet.remove());
    if (kind === 'compact') full.classList.add('test-count-concealed');
    else if (kind === 'suppressed') button.style.visibility = 'hidden';
    else anchor.style.display = 'none';
    await act(async () => {});
    expect(frames.size).toBe(0);
    expect(visual(full)).toBe(occupancyText(occupancy('60'), true));
    await act(async () => stale.forEach((callback) => callback(200)));
    expect(visual(full)).toBe(occupancyText(occupancy('60'), true));
    full.classList.remove('test-count-concealed');
    button.style.visibility = 'visible';
    anchor.style.display = '';
    await act(async () => {});
    expect(frames.size).toBe(0);
    view.rerender(f.tree(occupancy('80')));
    expect(frames.size).toBe(1);
    await paint(500);
    expect(visual(full)).toBe(occupancyText(occupancy('80'), true));
  },
);

it('does not turn actual ticker child-list churn into room demand, registration or packing at unchanged geometry', async () => {
  window.__roomLayoutDiagnosticsEnabled = true;
  const f = fixture(),
    surface = document.createElement('div'),
    host = document.createElement('div'),
    canvas = document.createElement('canvas'),
    mount = document.createElement('div');
  surface.dataset.roomSurface = 'true';
  host.append(canvas, mount);
  surface.append(host);
  document.body.append(surface);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 1280, 720),
  );
  const demand = vi.fn(),
    camera = {};
  const disconnect = f.registry.connect(canvas, demand, () => ({
    camera,
    projection: [1, 0, 0, 1],
    world: [1, 0, 0, 1],
  }));
  cleanups.add(() => {
    disconnect();
    surface.remove();
  });
  const view = render(f.tree(occupancy('20')), { container: mount });
  const button = screen.getByRole('button');
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
    () =>
      new DOMRect(
        400 + Number(button.dataset.labelDx ?? 0),
        200 + Number(button.dataset.labelDy ?? 0),
        420,
        44,
      ),
  );
  await act(async () => {});
  for (
    let pass = 0;
    pass < 6 && canvas.dataset.labelLayoutPending === 'true';
    pass++
  )
    await paint(0);
  expect(canvas.dataset.labelLayoutStatus).toBe('complete');
  const initialRevision = Number(canvas.dataset.labelLayoutRevision);
  view.rerender(f.tree(occupancy('60')));
  for (
    let pass = 0;
    pass < 6 && canvas.dataset.labelLayoutPending === 'true';
    pass++
  )
    await paint(0);
  expect(canvas.dataset.labelLayoutPending).toBe('false');
  expect(f.register).toHaveBeenCalledTimes(2);
  expect(Number(canvas.dataset.labelLayoutRevision)).toBe(initialRevision + 1);
  const revision = canvas.dataset.labelLayoutRevision,
    registrations = f.register.mock.calls.length;
  const ignored =
    window.__readRoomDemandSnapshot!(canvas)!.counters['mutation-ignored'];
  demand.mockClear();
  for (const time of [100, 250, 500]) await paint(time);
  expect(visual(button)).toBe(occupancyText(occupancy('60'), true));
  expect(
    window.__readRoomDemandSnapshot!(canvas)!.counters['mutation-ignored'],
  ).toBeGreaterThan(ignored);
  expect(demand).not.toHaveBeenCalled();
  expect(f.register).toHaveBeenCalledTimes(registrations);
  expect(canvas.dataset.labelLayoutRevision).toBe(revision);
  expect(canvas.dataset.labelLayoutPending).toBe('false');
  view.unmount();
});
