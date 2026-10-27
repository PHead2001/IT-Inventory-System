import room from '../../../../data/rooms/it-closet.json';
import { openingTransform } from './opening-transform';
import {
  LABEL_PACKING_BUDGET,
  type LabelArea,
  type LabelPlacement,
  type LabelRect,
  type LabelLayoutResult,
} from './label-layout';
import type { ExposedAnchorResult } from './exposed-anchor';

export const LABEL_DIAGNOSTIC_MAX_BYTES = 112 * 1024;
export const LABEL_DIAGNOSTIC_MAX_ENTRIES = 96;
const ids = new Set(['hover-tooltip']);
const codes = new Set([room.locationCode]);
function visit(nodes: typeof room.nodes) {
  for (const node of nodes) {
    ids.add(node.id);
    if ('locationCode' in node) codes.add(node.locationCode);
    if ('children' in node) visit(node.children as typeof room.nodes);
  }
}
visit(room.nodes);
for (const opening of room.openings) {
  const { origin } = openingTransform(
    opening as Parameters<typeof openingTransform>[0],
    room.dimensions as [number, number, number],
  );
  // Accept only the renderer's exact finite, checked-in opening coordinates.
  if (
    origin.every(
      (value, index) =>
        Number.isFinite(value) && value >= 0 && value <= room.dimensions[index],
    )
  )
    ids.add(`opening-${origin.join('-')}`);
}
type Pass = {
  labels: LabelRect[];
  viewport: LabelArea;
  reserved: LabelArea[];
  output?: LabelPlacement[];
  solver?: Pick<LabelLayoutResult, 'status' | 'stats'>;
};
type AttemptFailure =
  | 'measurement-budget'
  | 'placement-budget'
  | 'unstable-dimensions'
  | 'unmeasured-viewport';
export type LabelLayoutSnapshot = Readonly<{
  schema: 1;
  transaction: number;
  complete: boolean;
  settled: boolean;
  passes: Pass[];
  error?: 'invalid-data' | 'entry-bound' | 'pass-bound' | 'byte-bound';
  failure?: AttemptFailure;
}>;
declare global {
  interface Window {
    __roomLayoutDiagnosticsEnabled?: boolean;
    readonly __roomLabelLayoutSnapshot?: LabelLayoutSnapshot;
    readonly __roomVisibilitySnapshot?: RoomVisibilitySnapshot;
  }
}
type VisibilityEntry = {
  code: string;
  status: ExposedAnchorResult['status'];
  reason: string | null;
  work: ExposedAnchorResult['stats'];
};
export type RoomVisibilitySnapshot = Readonly<{
  schema: 1;
  revision: number;
  complete: boolean;
  entries: VisibilityEntry[];
}>;
const visibilityReasons = new Set([
  'viewport not measured',
  'scene revision pending',
  'cancelled',
  'projection context belongs to another scene or camera',
  'frame time allowance exhausted',
  'work budget exhausted',
  'orthographic camera required',
  'deformed or instanced geometry requires a projection adapter',
  'continuation frame limit reached',
  'non-finite projected geometry',
  'empty viewport',
  'surface witness rejected by authoritative ray',
  'surface proof pending',
]);
for (const reason of [...visibilityReasons])
  visibilityReasons.add('fingerprint incomplete: ' + reason);
visibilityReasons.add(
  'fingerprint unsupported within structural limits: work budget exhausted',
);
/** Last measured revision only, under the existing explicit diagnostic gate.
 * Copy fixed identities/status/work, never anchors, labels or raw error text. */
export function createRoomVisibilityDiagnostics(target?: Window) {
  if (target?.__roomLayoutDiagnosticsEnabled !== true) return null;
  let snapshot: RoomVisibilitySnapshot | undefined;
  try {
    Object.defineProperty(target, '__roomVisibilitySnapshot', {
      get: () => snapshot,
      configurable: true,
    });
  } catch {
    return null;
  }
  return {
    publish(
      revision: number,
      results: { code: string; result: ExposedAnchorResult }[],
    ) {
      try {
        if (
          !Number.isSafeInteger(revision) ||
          revision < 0 ||
          results.length > 96
        )
          throw new Error('invalid-data');
        const seen = new Set<string>();
        const entries = results.map(({ code, result }): VisibilityEntry => {
          if (
            !codes.has(code) ||
            seen.has(code) ||
            !['visible', 'hidden', 'pending', 'unresolved'].includes(
              result.status,
            )
          )
            throw new Error('invalid-data');
          seen.add(code);
          const stats = result.stats;
          const work = {
            triangles: finite(stats.triangles),
            overlaps: finite(stats.overlaps),
            fragments: finite(stats.fragments),
            operations: finite(stats.operations),
            revisionReused: bool(stats.revisionReused),
            rays: finite(stats.rays),
            elapsedMilliseconds: finite(stats.elapsedMilliseconds),
          };
          if (
            Object.values(work).some(
              (value) => typeof value === 'number' && value < 0,
            )
          )
            throw new Error('invalid-data');
          return {
            code,
            status: result.status,
            reason:
              'reason' in result
                ? visibilityReasons.has(result.reason)
                  ? result.reason
                  : 'unrecognized-reason'
                : null,
            work,
          };
        });
        const candidate = {
          schema: 1 as const,
          revision,
          complete: true,
          entries,
        };
        if (JSON.stringify(candidate).length > 48 * 1024)
          throw new Error('byte-bound');
        snapshot = freeze(candidate);
      } catch {
        snapshot = freeze({
          schema: 1,
          revision:
            Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
          complete: false,
          entries: [],
        });
      }
    },
  };
}
function finite(value: number) {
  if (!Number.isFinite(value)) throw new Error('invalid-data');
  return value;
}
function bool(value: boolean) {
  if (typeof value !== 'boolean') throw new Error('invalid-data');
  return value;
}
function keys(value: object, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('invalid-data');
}
function area(value: LabelArea): LabelArea {
  // DOMRects have extra fields; explicitly project only the packing inputs.
  return {
    left: finite(value.left),
    top: finite(value.top),
    right: finite(value.right),
    bottom: finite(value.bottom),
  };
}
function identity(id: string) {
  if (!ids.has(id)) throw new Error('invalid-data');
  return id;
}
function label(value: LabelRect): LabelRect {
  keys(value, [
    'id',
    'selected',
    'priority',
    'locationCode',
    'left',
    'top',
    'width',
    'height',
    'mandatory',
    'preferFull',
    'focused',
    'hovered',
    'pointer',
    'holdCompact',
    'compact',
    'previous',
  ]);
  const result: LabelRect = {
    id: identity(value.id),
    selected: bool(value.selected),
    left: finite(value.left),
    top: finite(value.top),
    width: finite(value.width),
    height: finite(value.height),
  };
  if (value.locationCode !== undefined) {
    if (!codes.has(value.locationCode)) throw new Error('invalid-data');
    result.locationCode = value.locationCode;
  }
  if (value.priority !== undefined) result.priority = finite(value.priority);
  for (const key of [
    'mandatory',
    'preferFull',
    'focused',
    'hovered',
    'holdCompact',
  ] as const)
    if (value[key] !== undefined) result[key] = bool(value[key]);
  if (value.compact) {
    keys(value.compact, ['width', 'height']);
    result.compact = {
      width: finite(value.compact.width),
      height: finite(value.compact.height),
    };
  }
  if (value.previous) {
    keys(value.previous, ['dx', 'dy', 'compact']);
    result.previous = {
      dx: finite(value.previous.dx),
      dy: finite(value.previous.dy),
      compact: bool(value.previous.compact),
    };
  }
  if (value.pointer) {
    keys(value.pointer, ['x', 'y', 'bounds']);
    keys(value.pointer.bounds, ['left', 'top', 'right', 'bottom']);
    result.pointer = {
      x: finite(value.pointer.x),
      y: finite(value.pointer.y),
      bounds: area(value.pointer.bounds),
    };
  }
  return result;
}
function placement(value: LabelPlacement): LabelPlacement {
  keys(value, ['id', 'visible', 'dx', 'dy', 'compact', 'yielded']);
  const result: LabelPlacement = {
    id: identity(value.id),
    visible: bool(value.visible),
    dx: finite(value.dx),
    dy: finite(value.dy),
  };
  if (value.compact !== undefined) result.compact = bool(value.compact);
  if (value.yielded !== undefined) result.yielded = bool(value.yielded);
  return result;
}
function solver(value: Pick<LabelLayoutResult, 'status' | 'stats'>) {
  if (
    !['complete', 'candidate-infeasible', 'budget-exhausted'].includes(
      value.status,
    )
  )
    throw Error('invalid-data');
  keys(value.stats, [
    'operations',
    'candidates',
    'nodes',
    'backtracks',
    'elapsedMs',
    'greedyComplete',
    'exhaustion',
  ]);
  const count = (value: number, maximum: number) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
      throw Error('invalid-data');
    return value;
  };
  const stats: LabelLayoutResult['stats'] = {
    operations: count(
      value.stats.operations,
      LABEL_PACKING_BUDGET.maxOperations,
    ),
    candidates: count(
      value.stats.candidates,
      LABEL_PACKING_BUDGET.maxCandidates,
    ),
    nodes: count(value.stats.nodes, LABEL_PACKING_BUDGET.maxNodes),
    backtracks: count(
      value.stats.backtracks,
      LABEL_PACKING_BUDGET.maxOperations,
    ),
    elapsedMs: finite(value.stats.elapsedMs),
    greedyComplete: bool(value.stats.greedyComplete),
  };
  if (stats.elapsedMs < 0) throw Error('invalid-data');
  if (value.stats.exhaustion) {
    const { reason, phase } = value.stats.exhaustion;
    keys(value.stats.exhaustion, ['reason', 'phase']);
    if (
      ![
        'time',
        'operations',
        'candidates',
        'nodes',
        'inputs',
        'per-label',
        'validation',
      ].includes(reason) ||
      ![
        'input',
        'preferred',
        'shared-slots',
        'candidate-axes',
        'candidate-domain',
        'search',
        'optional-expansion',
        'final-proof',
      ].includes(phase)
    )
      throw Error('invalid-data');
    stats.exhaustion = { reason, phase };
  }
  return { status: value.status, stats };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Optional observation only: no DOM, callbacks, scheduling or layout mutation. */
export function createLabelLayoutDiagnostics(target?: Window) {
  if (target?.__roomLayoutDiagnosticsEnabled !== true) return null;
  let transaction = 0;
  let snapshot: LabelLayoutSnapshot;
  let passes: Pass[] = [];
  let failed: LabelLayoutSnapshot['error'];
  let failure: AttemptFailure | undefined;
  function publish(complete = false, settled = false) {
    const candidate = {
      schema: 1 as const,
      transaction,
      complete,
      settled,
      passes,
      ...(failed ? { error: failed } : {}),
      ...(failure ? { failure } : {}),
    };
    if (JSON.stringify(candidate).length > LABEL_DIAGNOSTIC_MAX_BYTES)
      failed = 'byte-bound';
    // Never represent a partial/invalid fixture as complete; clear all passes.
    snapshot = freeze(
      failed
        ? {
            schema: 1,
            transaction,
            complete: false,
            settled: false,
            passes: [],
            error: failed,
          }
        : structuredClone(candidate),
    );
  }
  function attempt(work: () => void) {
    if (failed) return;
    try {
      work();
      publish();
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      failed =
        code === 'entry-bound' || code === 'pass-bound' ? code : 'invalid-data';
      publish();
    }
  }
  try {
    Object.defineProperty(target, '__roomLabelLayoutSnapshot', {
      get: () => snapshot,
      configurable: true,
    });
  } catch {
    return null;
  }
  return {
    begin() {
      transaction++;
      passes = [];
      failed = undefined;
      failure = undefined;
      publish();
    },
    input(labels: LabelRect[], viewport: LabelArea, reserved: LabelArea[]) {
      attempt(() => {
        if (passes.length >= 4) throw new Error('pass-bound');
        if (
          labels.length > LABEL_DIAGNOSTIC_MAX_ENTRIES ||
          reserved.length > 32
        )
          throw new Error('entry-bound');
        passes.push({
          labels: labels.map(label),
          viewport: area(viewport),
          reserved: reserved.map(area),
        });
      });
    },
    output(output: LabelPlacement[]) {
      attempt(() => {
        const pass = passes.at(-1);
        if (
          !pass ||
          output.length !== pass.labels.length ||
          output.some(
            (item) => !pass.labels.some((input) => input.id === item.id),
          )
        )
          throw new Error('invalid-data');
        pass.output = output.map(placement);
      });
    },
    solver(result: Pick<LabelLayoutResult, 'status' | 'stats'>) {
      attempt(() => {
        const pass = passes.at(-1);
        if (!pass) throw Error('invalid-data');
        pass.solver = solver(result);
      });
    },
    abort(reason: AttemptFailure) {
      attempt(() => {
        if (
          ![
            'measurement-budget',
            'placement-budget',
            'unstable-dimensions',
            'unmeasured-viewport',
          ].includes(reason)
        )
          throw Error('invalid-data');
        failure = reason;
      });
    },
    finish(settled: boolean) {
      if (failed) return;
      if (!passes.length || passes.some((pass) => !pass.output)) {
        failed = 'invalid-data';
        publish();
      } else publish(true, settled);
    },
  };
}
