import { expect, it } from 'vitest';
import {
  layoutLabels,
  layoutLabelsDetailed,
  type LabelRect,
} from './label-layout-test-harness';
import actualBelow from '../../../../tests/fixtures/room/actual-80d-more-below.json';
import {
  createLabelLayoutDiagnostics,
  createRoomVisibilityDiagnostics,
  LABEL_DIAGNOSTIC_MAX_BYTES,
  LABEL_DIAGNOSTIC_MAX_ENTRIES,
} from './label-layout-diagnostics';
import type { ExposedAnchorResult } from './exposed-anchor';

const viewport = { left: 0, top: 0, right: 375, bottom: 500 };
const visibilityWork = {
  triangles: 12,
  overlaps: 0,
  fragments: 0,
  operations: 4,
  revisionReused: false,
  rays: 1,
  elapsedMilliseconds: 0.5,
};
it('visibility observation is opt-in, copies current statuses/work, and replaces the preceding revision', () => {
  const off = {} as Window;
  expect(createRoomVisibilityDiagnostics(off)).toBeNull();
  expect(Object.keys(off)).toEqual([]);
  const target = { __roomLayoutDiagnosticsEnabled: true } as Window;
  const capture = createRoomVisibilityDiagnostics(target)!;
  const result = {
    status: 'pending' as const,
    reason: 'frame time allowance exhausted',
    stats: { ...visibilityWork },
  };
  capture.publish(7, [{ code: 'ITC-S1A', result }]);
  result.stats.rays = 99;
  expect(target.__roomVisibilitySnapshot).toMatchObject({
    revision: 7,
    complete: true,
    entries: [
      {
        code: 'ITC-S1A',
        status: 'pending',
        reason: 'frame time allowance exhausted',
        work: visibilityWork,
      },
    ],
  });
  expect(
    Object.isFrozen(target.__roomVisibilitySnapshot!.entries[0].work),
  ).toBe(true);
  capture.publish(8, [
    { code: 'ITC-S1B', result: { status: 'hidden', stats: visibilityWork } },
  ]);
  expect(
    target.__roomVisibilitySnapshot!.entries.map((entry) => entry.code),
  ).toEqual(['ITC-S1B']);
});
it('visibility diagnostics redact unknown reasons/extra data and refuse noncanonical identities or invalid work', () => {
  const target = { __roomLayoutDiagnosticsEnabled: true } as Window;
  const capture = createRoomVisibilityDiagnostics(target)!;
  capture.publish(1, [
    {
      code: 'ITC-S1A',
      result: {
        status: 'unresolved',
        reason: 'SECRET inventory value',
        stats: visibilityWork,
        privateValue: 'SECRET',
      } as ExposedAnchorResult,
    },
  ]);
  expect(target.__roomVisibilitySnapshot!.entries[0].reason).toBe(
    'unrecognized-reason',
  );
  expect(JSON.stringify(target.__roomVisibilitySnapshot)).not.toContain(
    'SECRET',
  );
  for (const entries of [
    [{ code: 'SECRET', result: { status: 'hidden', stats: visibilityWork } }],
    [
      {
        code: 'ITC-S1A',
        result: { status: 'hidden', stats: { ...visibilityWork, rays: NaN } },
      },
    ],
    [
      {
        code: 'ITC-S1A',
        result: {
          status: 'hidden',
          stats: { ...visibilityWork, elapsedMilliseconds: -1 },
        },
      },
    ],
    Array.from({ length: 97 }, () => ({
      code: 'ITC-S1A',
      result: { status: 'hidden', stats: visibilityWork },
    })),
  ]) {
    capture.publish(
      2,
      entries as { code: string; result: ExposedAnchorResult }[],
    );
    expect(target.__roomVisibilitySnapshot).toEqual({
      schema: 1,
      revision: 2,
      complete: false,
      entries: [],
    });
  }
});
const input = (): LabelRect => ({
  id: 'shelf-1a',
  locationCode: 'ITC-S1A',
  selected: true,
  priority: 4,
  left: 20,
  top: 30,
  width: 80,
  height: 44,
  mandatory: true,
  preferFull: false,
  focused: false,
  hovered: true,
  holdCompact: false,
  compact: { width: 44, height: 44 },
  previous: { dx: 8, dy: -8, compact: false },
  pointer: {
    x: 30,
    y: 40,
    bounds: { left: 20, top: 30, right: 100, bottom: 74 },
  },
});
function harness() {
  const target = { __roomLayoutDiagnosticsEnabled: true } as Window;
  return { target, capture: createLabelLayoutDiagnostics(target)! };
}
it('captures actual bounded shared-slot exhaustion through the existing opt-in schema', () => {
  const { target, capture } = harness(),
    { labels, viewport: bounds, reserved } = actualBelow.input;
  const result = layoutLabelsDetailed(
    labels,
    bounds,
    reserved,
    { maxNodes: 0 },
    () => 0,
  );
  expect(result.status).toBe('budget-exhausted');
  expect(result.stats.exhaustion).toEqual({
    reason: 'nodes',
    phase: 'shared-slots',
  });
  capture.begin();
  capture.input(labels, bounds, reserved);
  capture.solver(result);
  capture.output(result.placements);
  capture.finish(true);
  expect(target.__roomLabelLayoutSnapshot!.complete).toBe(true);
  expect(
    target.__roomLabelLayoutSnapshot!.passes[0].solver!.stats.exhaustion,
  ).toEqual(result.stats.exhaustion);
});
it('copies bounded solver work and first exhaustion metadata without mutating or leaking extra fields', () => {
  const { target, capture } = harness();
  const result = {
    status: 'budget-exhausted' as const,
    stats: {
      operations: 150,
      candidates: 32,
      nodes: 2,
      backtracks: 1,
      elapsedMs: 0.5,
      greedyComplete: false,
      exhaustion: { reason: 'nodes' as const, phase: 'search' as const },
    },
  };
  capture.begin();
  capture.input([input()], viewport, []);
  capture.solver(result);
  capture.output(layoutLabels([input()], viewport));
  capture.finish(true);
  const snapshot = target.__roomLabelLayoutSnapshot!;
  expect(snapshot.passes[0].solver).toEqual(result);
  result.stats.operations = 999;
  expect(snapshot.passes[0].solver!.stats.operations).toBe(150);
  expect(Object.isFrozen(snapshot.passes[0].solver!.stats.exhaustion)).toBe(
    true,
  );
  expect(JSON.stringify(snapshot).length).toBeLessThan(
    LABEL_DIAGNOSTIC_MAX_BYTES,
  );
});
it('rejects unknown solver reasons, phases, private metadata and unbounded counters', () => {
  const stats = {
    operations: 1,
    candidates: 0,
    nodes: 0,
    backtracks: 0,
    elapsedMs: 0,
    greedyComplete: false,
  };
  for (const invalid of [
    { ...stats, operations: 2_000_001 },
    { ...stats, candidates: -1 },
    { ...stats, nodes: Infinity },
    { ...stats, elapsedMs: NaN },
    { ...stats, privateMessage: 'SECRET' },
    { ...stats, exhaustion: { reason: 'SECRET', phase: 'search' } },
    { ...stats, exhaustion: { reason: 'time', phase: 'SECRET' } },
    {
      ...stats,
      exhaustion: { reason: 'time', phase: 'search', stack: 'SECRET' },
    },
  ]) {
    const { target, capture } = harness();
    capture.begin();
    capture.input([input()], viewport, []);
    capture.solver({ status: 'budget-exhausted', stats: invalid } as Parameters<
      typeof capture.solver
    >[0]);
    expect(target.__roomLabelLayoutSnapshot).toMatchObject({
      complete: false,
      passes: [],
      error: 'invalid-data',
    });
    expect(JSON.stringify(target.__roomLabelLayoutSnapshot)).not.toContain(
      'SECRET',
    );
  }
});
it('records fixed actual measurement failures explicitly and rejects arbitrary failure text', () => {
  const { target, capture } = harness();
  capture.begin();
  capture.abort('measurement-budget');
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    transaction: 1,
    complete: false,
    settled: false,
    passes: [],
    failure: 'measurement-budget',
  });
  capture.begin();
  capture.abort('SECRET' as Parameters<typeof capture.abort>[0]);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    complete: false,
    passes: [],
    error: 'invalid-data',
  });
  expect(JSON.stringify(target.__roomLabelLayoutSnapshot)).not.toContain(
    'SECRET',
  );
});
it('is disabled by default and adds no global snapshot or application mutation', () => {
  const target = {} as Window;
  expect(createLabelLayoutDiagnostics(target)).toBeNull();
  expect(Object.keys(target)).toEqual([]);
});
it('copies every packing input/output exactly before mutation, preserving layout and read-only snapshots', () => {
  const { target, capture } = harness();
  const labels = [input()];
  const before = structuredClone(labels);
  const reserved = [{ left: 200, top: 100, right: 300, bottom: 150 }];
  capture.begin();
  capture.input(labels, viewport, reserved);
  const output = layoutLabels(labels, viewport, reserved);
  capture.output(output);
  capture.finish(true);
  expect(labels).toEqual(before);
  expect(output).toEqual(layoutLabels(before, viewport, reserved));
  expect(target.__roomLabelLayoutSnapshot!.passes[0]).toEqual({
    labels: before,
    viewport,
    reserved,
    output,
  });
  labels[0].pointer!.bounds.left = 999;
  labels[0].previous!.dx = 999;
  output[0].dx = 999;
  reserved[0].left = 999;
  expect(target.__roomLabelLayoutSnapshot!.passes[0].labels).toEqual(before);
  expect(target.__roomLabelLayoutSnapshot!.passes[0].output![0].dx).not.toBe(
    999,
  );
  expect(
    Object.getOwnPropertyDescriptor(target, '__roomLabelLayoutSnapshot')!.set,
  ).toBeUndefined();
  expect(
    Object.isFrozen(
      target.__roomLabelLayoutSnapshot!.passes[0].labels[0].pointer!.bounds,
    ),
  ).toBe(true);
  capture.begin();
  expect(target.__roomLabelLayoutSnapshot!.transaction).toBe(2);
  expect(target.__roomLabelLayoutSnapshot!.passes).toEqual([]);
});
it.each([
  { ...input(), id: 'private-inventory-name' },
  { ...input(), id: 'opening-999999-0-0' },
  { ...input(), locationCode: 'PRIVATE' },
  { ...input(), left: NaN },
  { ...input(), previous: { dx: Infinity, dy: 0, compact: true } },
  { ...input(), readableSummary: 'SECRET inventory summary' },
  { ...input(), pointer: { ...input().pointer!, mutate: () => {} } },
])('rejects unallowlisted data without emitting a partial fixture', (value) => {
  const { target, capture } = harness();
  capture.begin();
  capture.input([value as LabelRect], viewport, []);
  capture.finish(true);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    complete: false,
    passes: [],
    error: 'invalid-data',
  });
  expect(JSON.stringify(target.__roomLabelLayoutSnapshot)).not.toMatch(
    /SECRET|private-inventory-name|PRIVATE|mutate/,
  );
});
it('accepts only exact checked-in renderer opening identities', () => {
  const { target, capture } = harness();
  const labels = [{ ...input(), id: 'opening-42-0-0' }];
  capture.begin();
  capture.input(labels, viewport, []);
  capture.output(layoutLabels(labels, viewport));
  capture.finish(true);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    complete: true,
    passes: [{ labels }],
  });
});
it('never marks a missing layout output as a complete fixture', () => {
  const { target, capture } = harness();
  capture.begin();
  capture.input([input()], viewport, []);
  capture.finish(true);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    complete: false,
    passes: [],
    error: 'invalid-data',
  });
});
it.each([
  { id: 'shelf-1a', visible: true, dx: Infinity, dy: 0 },
  { id: 'private-output-name', visible: true, dx: 0, dy: 0 },
  { id: 'shelf-1a', visible: true, dx: 0, dy: 0, readableSummary: 'SECRET' },
])('rejects unsafe placement output without exposing it', (output) => {
  const { target, capture } = harness();
  capture.begin();
  capture.input([input()], viewport, []);
  capture.output([output]);
  capture.finish(true);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    complete: false,
    passes: [],
    error: 'invalid-data',
  });
  expect(JSON.stringify(target.__roomLabelLayoutSnapshot)).not.toMatch(
    /SECRET|private-output-name/,
  );
});
it('fails explicitly on entry, reservation, pass and byte limits rather than truncating', () => {
  for (const [labels, reserved] of [
    [Array.from({ length: LABEL_DIAGNOSTIC_MAX_ENTRIES + 1 }, input), []],
    [[input()], Array.from({ length: 33 }, () => viewport)],
  ] as const) {
    const { target, capture } = harness();
    capture.begin();
    capture.input([...labels], viewport, [...reserved]);
    capture.finish(true);
    expect(target.__roomLabelLayoutSnapshot).toMatchObject({
      complete: false,
      passes: [],
      error: 'entry-bound',
    });
  }
  const bounded = harness();
  bounded.capture.begin();
  for (let pass = 0; pass < 5; pass++)
    bounded.capture.input([input()], viewport, []);
  expect(bounded.target.__roomLabelLayoutSnapshot!.error).toBe('pass-bound');
  const bytes = harness();
  bytes.capture.begin();
  const large = () => {
    const value = input();
    const n = 1.2345678901234567e200;
    return {
      ...value,
      left: n,
      top: n,
      width: n,
      height: n,
      priority: n,
      compact: { width: n, height: n },
      previous: { dx: n, dy: n, compact: false },
      pointer: { x: n, y: n, bounds: { left: n, top: n, right: n, bottom: n } },
    };
  };
  for (let pass = 0; pass < 4; pass++)
    bytes.capture.input(Array.from({ length: 96 }, large), viewport, []);
  bytes.capture.finish(true);
  expect(bytes.target.__roomLabelLayoutSnapshot).toMatchObject({
    complete: false,
    passes: [],
    error: 'byte-bound',
  });
  expect(
    JSON.stringify(bytes.target.__roomLabelLayoutSnapshot).length,
  ).toBeLessThanOrEqual(LABEL_DIAGNOSTIC_MAX_BYTES);
});

it('keeps timing unavailable without caller timestamps instead of borrowing solver timing', () => {
  const { target, capture } = harness();
  capture.begin();
  capture.input([input()], viewport, []);
  const result = layoutLabelsDetailed(
    [input()],
    viewport,
    [],
    undefined,
    () => 0,
  );
  capture.solver({ ...result, stats: { ...result.stats, elapsedMs: 8 } });
  capture.output(result.placements);
  capture.finish(true);
  expect(target.__roomLabelLayoutSnapshot!.runtime).toEqual({
    terminal: 'complete',
    timing: { source: 'unavailable', stages: [] },
  });
  expect(target.__roomLabelLayoutSnapshot!.lastAttempt).toEqual({
    transaction: 1,
    terminal: 'complete',
    timingSource: 'unavailable',
    passCount: 1,
  });
});
it('retains only twelve scalar transaction summaries and makes omitted IDs explicit', () => {
  const { target, capture } = harness();
  for (let id = 1; id <= 16; id++) {
    capture.begin(id * 100);
    capture.abort('measurement-budget', id * 100 + id);
  }
  const snapshot = target.__roomLabelLayoutSnapshot!;
  expect(snapshot.transaction).toBe(16);
  expect(snapshot.omittedTransactions).toBe(4);
  expect(
    snapshot.recentTransactions!.map(({ transaction }) => transaction),
  ).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  for (const summary of snapshot.recentTransactions!) {
    expect(
      Object.values(summary).every(
        (value) =>
          typeof value === 'number' ||
          ['runtime', 'measurement-budget'].includes(value),
      ),
    ).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(summary).not.toHaveProperty('passes');
  }
  expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(
    LABEL_DIAGNOSTIC_MAX_BYTES,
  );
});
it('publishes begin immediately and keeps cached attempt IDs distinct from retained actual detail', () => {
  const { target, capture } = harness();
  capture.begin(10);
  capture.abort('measurement-budget', 30);
  const actual = target.__roomLabelLayoutSnapshot!;
  capture.begin(40);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    transaction: 2,
    passes: [],
    runtime: { terminal: 'pending' },
  });
  capture.mark('initial-measurement-start', 40);
  capture.mark('initial-measurement-end', 42);
  capture.cachedSuppression(43);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    transaction: 1,
    failure: 'measurement-budget',
    passes: [],
    runtime: actual.runtime,
    lastAttempt: {
      transaction: 2,
      terminal: 'cached-suppression',
      cacheSourceTransaction: 1,
      elapsedMs: 3,
      solverElapsedMs: 0,
      passCount: 0,
    },
  });
  capture.begin(50);
  capture.abort('unmeasured-viewport', 51);
  expect(target.__roomLabelLayoutSnapshot).toMatchObject({
    transaction: 3,
    failure: 'unmeasured-viewport',
    lastAttempt: { transaction: 3, terminal: 'unmeasured-viewport' },
  });
});
it('rejects private or invalid timing data with the existing fail-closed fixture semantics', () => {
  for (const corrupt of [
    (capture: ReturnType<typeof harness>['capture']) =>
      capture.mark('SECRET' as never, 2),
    (capture: ReturnType<typeof harness>['capture']) =>
      capture.mark('solver-entry', NaN),
    (capture: ReturnType<typeof harness>['capture']) =>
      capture.mark('solver-entry', 0),
    (capture: ReturnType<typeof harness>['capture']) =>
      capture.mark('solver-entry', 2, 5),
    (capture: ReturnType<typeof harness>['capture']) =>
      capture.mark('solver-entry', 2, 1, {
        maxOperations: 1,
        maxCandidates: 1,
        maxNodes: 1,
        maxMilliseconds: 1,
        maxInputs: 1,
        maxCandidatesPerLabel: 1,
        privateText: 'SECRET',
      } as never),
    (capture: ReturnType<typeof harness>['capture']) =>
      capture.mark('solver-end', 2),
  ]) {
    const { target, capture } = harness();
    capture.begin(1);
    capture.input([input()], viewport, []);
    corrupt(capture);
    capture.abort('measurement-budget', 3);
    expect(target.__roomLabelLayoutSnapshot).toMatchObject({
      complete: false,
      passes: [],
      error: 'invalid-data',
      runtime: { terminal: 'invalid-data' },
      lastAttempt: { terminal: 'invalid-data' },
    });
    expect(JSON.stringify(target.__roomLabelLayoutSnapshot)).not.toContain(
      'SECRET',
    );
  }
});
it('evicts scalar history under byte pressure without increasing the fixture cap', () => {
  // Construct a complete canonical fixture within 512-800 bytes of the cap.
  // Twelve scalar summaries cannot all coexist with it, even though the exact
  // four-pass fixture itself fits without truncation.
  let labels: LabelRect[] = [],
    reserved: (typeof viewport)[] = [];
  let closestBytes = 0;
  for (let count = 1; count <= 96; count++) {
    const candidateLabels = Array.from({ length: count }, input);
    const output = candidateLabels.map(({ id }) => ({
      id,
      visible: true,
      dx: 0,
      dy: 0,
    }));
    for (let masks = 0; masks <= 32; masks++) {
      const candidateReserved = Array.from({ length: masks }, () => viewport);
      const summary = {
        transaction: 13,
        terminal: 'complete',
        timingSource: 'runtime',
        elapsedMs: 2,
        solverElapsedMs: 0,
        passCount: 4,
      };
      const bytes = JSON.stringify({
        schema: 1,
        transaction: 13,
        complete: true,
        settled: true,
        passes: Array.from({ length: 4 }, () => ({
          labels: candidateLabels,
          viewport,
          reserved: candidateReserved,
          output,
        })),
        runtime: {
          terminal: 'complete',
          timing: {
            source: 'runtime',
            elapsedMs: 2,
            solverElapsedMs: 0,
            stages: [{ stage: 'terminal', elapsedMs: 2 }],
          },
        },
        recentTransactions: [summary],
        omittedTransactions: 12,
        lastAttempt: summary,
      }).length;
      if (bytes <= LABEL_DIAGNOSTIC_MAX_BYTES - 512 && bytes > closestBytes) {
        closestBytes = bytes;
        labels = candidateLabels;
        reserved = candidateReserved;
      }
    }
  }
  expect(closestBytes).toBeGreaterThan(LABEL_DIAGNOSTIC_MAX_BYTES - 800);
  const { target, capture } = harness();
  for (let i = 0; i < 12; i++) {
    capture.begin(0);
    capture.abort('measurement-budget', 1);
  }
  capture.begin(0);
  for (let pass = 0; pass < 4; pass++) {
    capture.input(labels, viewport, reserved);
    capture.output(
      labels.map(({ id }) => ({ id, visible: true, dx: 0, dy: 0 })),
    );
  }
  capture.finish(true, 2);
  const snapshot = target.__roomLabelLayoutSnapshot!;
  expect(snapshot.error).toBeUndefined();
  expect(snapshot.complete).toBe(true);
  expect(snapshot.passes).toHaveLength(4);
  expect(
    snapshot.passes.every(
      (pass) =>
        pass.labels.length === labels.length &&
        pass.reserved.length === reserved.length,
    ),
  ).toBe(true);
  expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(
    LABEL_DIAGNOSTIC_MAX_BYTES,
  );
  expect(snapshot.recentTransactions!.length).toBeLessThan(12);
  expect(snapshot.omittedTransactions).toBeGreaterThan(1);
});
