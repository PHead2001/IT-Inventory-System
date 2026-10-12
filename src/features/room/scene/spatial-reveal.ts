import type { RoomDefinition, RoomNode } from '../schema';
import type { RoomBinding } from '../bindings';

export const SPATIAL_MOTION = Object.freeze({
  flightMs: 750,
  revealMs: 400,
  intensity: 1,
});
export type FocusRequest = Readonly<{
  code: string | null;
  requestId: number;
  scope?: string;
  generation?: number;
  fitBeforeFlight?: boolean;
  preserveView?: boolean;
}>;
export type FocusToken = Readonly<{
  scope: string;
  generation: number;
  requestId: number;
  code: string | null;
}>;
export function focusToken(request: FocusRequest, scope: string): FocusToken {
  return Object.freeze({
    scope: request.scope ?? scope,
    generation: request.generation ?? 0,
    requestId: request.requestId,
    code: request.code,
  });
}
export function sameFocusToken(a: FocusToken | null, b: FocusToken | null) {
  return (
    !!a &&
    !!b &&
    a.scope === b.scope &&
    a.generation === b.generation &&
    a.requestId === b.requestId &&
    a.code === b.code
  );
}
export type RevealState = Readonly<{
  token: FocusToken | null;
  phase: 'idle' | 'flying' | 'revealing' | 'settled' | 'cancelled';
  openCode: string | null;
  started: number;
}>;

/** Presentation only. Logical selection and inventory remain workspace owned. */
export function createSpatialRevealController() {
  let state: RevealState = Object.freeze({
    token: null,
    phase: 'idle',
    openCode: null,
    started: 0,
  });
  const listeners = new Set<() => void>();
  const write = (next: RevealState) => {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const valid = (token: FocusToken) =>
    sameFocusToken(state.token, token) && state.phase !== 'cancelled';
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(token: FocusToken, bound: boolean, now: number) {
      write({
        token,
        phase:
          token.code && bound ? 'flying' : token.code ? 'cancelled' : 'idle',
        openCode: bound && state.openCode === token.code ? token.code : null,
        started: now,
      });
    },
    finishFlight(token: FocusToken, now: number, reduced = false) {
      if (!valid(token) || state.phase !== 'flying') return false;
      write({
        ...state,
        phase: reduced ? 'settled' : 'revealing',
        openCode: token.code,
        started: now,
      });
      return true;
    },
    settle(token: FocusToken) {
      if (!valid(token) || state.phase !== 'revealing') return false;
      write({ ...state, phase: 'settled' });
      return true;
    },
    interrupt(token: FocusToken | null = state.token) {
      if (!token || !sameFocusToken(state.token, token)) return;
      write({
        ...state,
        phase:
          state.phase === 'revealing' || state.phase === 'settled'
            ? 'settled'
            : 'cancelled',
      });
    },
    dispose() {
      write({ token: null, phase: 'cancelled', openCode: null, started: 0 });
    },
    valid,
  };
}
export type SpatialRevealController = ReturnType<
  typeof createSpatialRevealController
>;

export function revealOffset(node: RoomNode): [number, number, number] {
  const offset = node.visual?.reveal?.offset;
  return offset
    ? (offset.map((value) => value * SPATIAL_MOTION.intensity) as [
        number,
        number,
        number,
      ])
    : [0, 0, 0];
}

/** Separate camera envelope: never alter resting logical bindings or focus points. */
export function presentationBindings(
  room: RoomDefinition,
  bindings: RoomBinding[],
): RoomBinding[] {
  const offsets = new Map<string, [number, number, number]>();
  const visit = (nodes: RoomNode[], parentRotation: number) => {
    for (const node of nodes) {
      const rotation = parentRotation + node.rotationZDegrees;
      const [x, y, z] = revealOffset(node);
      const angle = (rotation * Math.PI) / 180;
      offsets.set(node.id, [
        x * Math.cos(angle) - y * Math.sin(angle),
        x * Math.sin(angle) + y * Math.cos(angle),
        z,
      ]);
      visit(node.children ?? [], rotation);
    }
  };
  visit(room.nodes, 0);
  return bindings.map((binding) => {
    const offset = offsets.get(binding.nodeId) ?? [0, 0, 0];
    return {
      ...binding,
      bounds: {
        min: binding.bounds.min.map((value, axis) =>
          Math.min(value, value + offset[axis]),
        ) as [number, number, number],
        max: binding.bounds.max.map((value, axis) =>
          Math.max(value, value + offset[axis]),
        ) as [number, number, number],
      },
    };
  });
}
