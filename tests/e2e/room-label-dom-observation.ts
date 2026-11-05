import type { RoomDemandSnapshot } from './room-demand-snapshot';
export type RoomLabelDomSnapshot = {
  schema: 1;
  overflow: boolean;
  kinds: Record<
    string,
    { newElements: number; attributeWrites: number; removals: number }
  >;
  recent: { kind: string; serial: number; event: string }[];
};
declare global {
  interface Window {
    __readRoomLabelDomSnapshot?: () => RoomLabelDomSnapshot;
  }
}
/** Test-only DOM observation. Connected attribute writes witness registration
 * metadata, not exact register() calls: detached writes and removals are not
 * inferred. Observe only the registration attribute so unrelated page mounting
 * cannot exhaust the diagnostic before the room registers its first label. No
 * element text, arbitrary identifiers, geometry, scheduling or DOM writes. */
export function installRoomLabelDomObservation() {
  if (window.__readRoomLabelDomSnapshot) return;
  const kinds = Object.fromEntries(
    [
      'tooltip',
      'occupied-marker',
      'anchored-action',
      'decorative',
      'other',
    ].map((kind) => [
      kind,
      { newElements: 0, attributeWrites: 0, removals: 0 },
    ]),
  ) as RoomLabelDomSnapshot['kinds'];
  const recent: RoomLabelDomSnapshot['recent'] = [];
  const seen = new WeakMap<Element, number>();
  let serial = 0,
    overflow = false;
  let stopped = false;
  const saturate = () => {
    overflow = true;
    stopped = true;
    observer.disconnect();
  };
  const kindOf = (element: Element) =>
    element.getAttribute('data-label-layout-id') === 'hover-tooltip'
      ? 'tooltip'
      : element.hasAttribute('data-room-occupied-marker')
        ? 'occupied-marker'
        : element.tagName === 'BUTTON' &&
            element.hasAttribute('data-room-label-code')
          ? 'anchored-action'
          : element.hasAttribute('data-room-decorative-label')
            ? 'decorative'
            : 'other';
  const record = (element: Element, event: 'attributeWrites') => {
    const kind = kindOf(element);
    let identity = seen.get(element);
    if (!identity) {
      if (serial >= 1000) {
        saturate();
        return false;
      }
      identity = ++serial;
      seen.set(element, identity);
      kinds[kind].newElements++;
    }
    if (kinds[kind][event] >= 1_000_000) {
      saturate();
      return false;
    }
    kinds[kind][event]++;
    recent.push({ kind, serial: identity, event });
    if (recent.length > 12) recent.shift();
    return true;
  };
  const observer = new MutationObserver((records) => {
    if (stopped) return;
    // Only registration-attribute records are subscribed. Cap a delivery before
    // reading an unbounded set; no child-list/subtree traversal is performed.
    let work = 0;
    const spend = () => {
      if (stopped) return false;
      if (++work > 256) {
        saturate();
        return false;
      }
      return true;
    };
    try {
      for (const mutation of records) {
        if (!spend()) return;
        if (mutation.type === 'attributes') {
          if (
            mutation.target instanceof Element &&
            !record(mutation.target, 'attributeWrites')
          )
            return;
        }
      }
    } catch {
      saturate();
    }
  });
  observer.observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-label-layout-id'],
  });
  Object.defineProperty(window, '__readRoomLabelDomSnapshot', {
    configurable: true,
    value: () => ({
      schema: 1,
      overflow,
      kinds: structuredClone(kinds),
      recent: [...recent],
    }),
  });
  return () => observer.disconnect();
}

/** The exact existing browser poll read, shared with focused regression tests. */
export async function readRoomLabelSettleState(element: HTMLCanvasElement) {
  // Let the requested control update project and measure before accepting
  // a settled flag that could still belong to the previous camera frame.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const current = {
    pending: element.dataset.labelLayoutPending,
    revision: Number(element.dataset.labelLayoutRevision ?? 0),
    frame: [
      element.dataset.cameraViewMatrix,
      element.dataset.cameraProjectionMatrix,
    ],
  };
  const counter = (value: string | undefined) => {
    const number = Number(value);
    return value !== undefined &&
      Number.isSafeInteger(number) &&
      number >= 0 &&
      number <= 1_000_000
      ? number
      : null;
  };
  let demand: RoomDemandSnapshot | null = null;
  try {
    demand = window.__readRoomDemandSnapshot?.(element) ?? null;
  } catch {
    /* A blocked diagnostic reader cannot change readiness. */
  }
  let labelDom: RoomLabelDomSnapshot | null = null;
  try {
    labelDom = window.__readRoomLabelDomSnapshot?.() ?? null;
  } catch {
    /* A blocked DOM diagnostic cannot change readiness. */
  }
  try {
    const statuses = ['complete', 'candidate-infeasible', 'budget-exhausted'];
    const errors = [
      'Room viewport is not measured',
      'Label measurement work budget exhausted',
      'Label placement work budget exhausted',
      'Label remeasurement work budget exhausted',
      'Unstable label dimensions after four placement passes',
    ];
    const errorIndex = errors.indexOf(element.dataset.labelLayoutError ?? '');
    return {
      current,
      demand,
      labelDom,
      phase: ['idle', 'flying', 'revealing', 'settled', 'cancelled'].includes(
        element.dataset.spatialPhase ?? '',
      )
        ? element.dataset.spatialPhase!
        : null,
      sceneFrames: counter(element.dataset.sceneEffectFrames),
      composerFrames: counter(element.dataset.composerFrames),
      status: statuses.includes(element.dataset.labelLayoutStatus ?? '')
        ? element.dataset.labelLayoutStatus!
        : 'unknown',
      // Only fixed codes leave the browser, never arbitrary attribute text.
      layoutError:
        errorIndex >= 0
          ? [
              'viewport-unmeasured',
              'measurement-budget',
              'placement-budget',
              'remeasurement-budget',
              'unstable-dimensions',
            ][errorIndex]
          : element.dataset.labelLayoutError === undefined
            ? null
            : 'unknown',
    };
  } catch {
    return {
      current,
      demand: null,
      labelDom: null,
      status: 'unavailable',
      layoutError: 'unavailable',
      phase: null,
      sceneFrames: null,
      composerFrames: null,
    };
  }
}
