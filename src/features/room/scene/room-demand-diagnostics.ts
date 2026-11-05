/** Opt-in counters only. Never schedules, renders, reads layout or writes DOM. */
export const ROOM_DEMAND_REASONS = [
  'anchor',
  'reveal-effect',
  'reveal-frame',
  'camera-update',
  'camera-ready',
  'camera-reveal',
  'camera-flight-end',
  'camera-flight',
  'visibility-continuation',
  'visibility-retry',
  'effects-selection',
  'effects-publication',
  'contact-update',
  'contact-wait',
  'contact-capture',
  'hover-effect',
  'hover-frame',
  'bloom-overlay',
  'bloom-attach',
  'bloom-input',
  'pointer-sample',
  'selection-effect',
  'selection-frame',
  'palette',
  'layout-external',
  'resize-scene',
  'mutation-scene',
  'font-loaded',
  'font-ready',
  'window-scroll',
  'window-resize',
  'visual-scroll',
  'visual-resize',
  'label-register',
  'label-unregister',
  'driver-schedule',
  'resize-continuation',
  'resize-canvas',
  'resize-label',
  'resize-obstruction',
  'resize-first',
  'resize-changed',
  'resize-identical',
  'mutation-geometry',
  'mutation-unmeasurable',
  'mutation-obstruction',
  'mutation-ignored',
] as const;
export type RoomDemandReason = (typeof ROOM_DEMAND_REASONS)[number];
export const ROOM_DEMAND_COUNTER_CAP = 1_000_000;
export const ROOM_DEMAND_MAX_BYTES = 4096;
export type RoomDemandSnapshot = Readonly<{
  schema: 1;
  bound: boolean;
  preconnectObserved: false;
  bindingCount: number;
  overflow: boolean;
  counters: Readonly<Record<RoomDemandReason, number>>;
}>;
declare global {
  interface Window {
    readonly __readRoomDemandSnapshot?: (
      canvas: unknown,
    ) => RoomDemandSnapshot | null;
  }
}
type State = {
  target: Window;
  token: object;
  bound: boolean;
  bindingCount: number;
  overflow: boolean;
  counters: Record<RoomDemandReason, number>;
  sizes: WeakMap<Element, { width: number; height: number }>;
};
type DemandSource = object | null | undefined;
const states = new WeakMap<object, State>();
const bindings = new WeakMap<
  object,
  { canvas: HTMLCanvasElement; token: object }
>();
const noop = () => {};
function readSnapshot(canvas: unknown): RoomDemandSnapshot | null {
  try {
    if (!canvas || typeof canvas !== 'object') return null;
    const state = active(canvas);
    if (!state) return null;
    return Object.freeze({
      schema: 1,
      bound: state.bound,
      preconnectObserved: false,
      bindingCount: state.bindingCount,
      overflow: state.overflow,
      counters: Object.freeze({ ...state.counters }),
    });
  } catch {
    return null;
  }
}
function active(source: DemandSource) {
  if (!source) return;
  const binding = bindings.get(source);
  const state = states.get(binding?.canvas ?? source);
  return state?.bound &&
    (!binding || binding.token === state.token) &&
    state.target.__roomLayoutDiagnosticsEnabled === true
    ? state
    : undefined;
}
function increment(state: State, reason: RoomDemandReason) {
  if (!Object.hasOwn(state.counters, reason)) return;
  if (state.counters[reason] < ROOM_DEMAND_COUNTER_CAP)
    state.counters[reason]++;
  else state.overflow = true;
}
/** Connect inside the existing label-driver effect. A stale cleanup owns nothing. */
export function bindRoomDemand(
  canvas: HTMLCanvasElement,
  invalidate?: () => void,
  target: Window | undefined = typeof window === 'undefined'
    ? undefined
    : window,
) {
  try {
    if (target?.__roomLayoutDiagnosticsEnabled !== true) return noop;
    // A blocked/foreign property disables observation, never renderer work.
    const descriptor = Object.getOwnPropertyDescriptor(
      target,
      '__readRoomDemandSnapshot',
    );
    if (descriptor && descriptor.value !== readSnapshot) return noop;
    if (!descriptor)
      Object.defineProperty(target, '__readRoomDemandSnapshot', {
        value: readSnapshot,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    const token = {};
    const state = states.get(canvas) ?? {
      target,
      token,
      bound: false,
      bindingCount: 0,
      overflow: false,
      counters: Object.fromEntries(
        ROOM_DEMAND_REASONS.map((reason) => [reason, 0]),
      ) as Record<RoomDemandReason, number>,
      sizes: new WeakMap<Element, { width: number; height: number }>(),
    };
    state.target = target;
    state.token = token;
    state.bound = true;
    if (state.bindingCount < ROOM_DEMAND_COUNTER_CAP) state.bindingCount++;
    else state.overflow = true;
    states.set(canvas, state);
    if (invalidate) bindings.set(invalidate, { canvas, token });
    return () => {
      try {
        if (invalidate && bindings.get(invalidate)?.token === token)
          bindings.delete(invalidate);
        if (state.token !== token) return;
        state.bound = false;
      } catch {
        /* Observation cannot affect renderer teardown. */
      }
    };
  } catch {
    return noop;
  }
}
/** Call immediately before the existing invalidate, under its existing guard. */
export function recordRoomDemand(
  source: DemandSource,
  reason: RoomDemandReason,
) {
  try {
    const state = active(source);
    if (state) increment(state, reason);
  } catch {
    /* Observation cannot prevent the original invalidation. */
  }
}
/** contentRect is delivered by RO; no additional geometry read is performed. */
export function recordRoomResize(
  canvas: HTMLCanvasElement,
  record: ResizeObserverEntry,
  kind: 'canvas' | 'label' | 'obstruction',
) {
  try {
    const state = active(canvas);
    if (!state) return;
    increment(state, `resize-${kind}`);
    const { width, height } = record.contentRect;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 0 ||
      height < 0
    )
      return;
    const prior = state.sizes.get(record.target);
    increment(
      state,
      !prior
        ? 'resize-first'
        : prior.width === width && prior.height === height
          ? 'resize-identical'
          : 'resize-changed',
    );
    state.sizes.set(record.target, { width, height });
  } catch {
    /* Malformed diagnostic input does not affect RO behavior. */
  }
}
