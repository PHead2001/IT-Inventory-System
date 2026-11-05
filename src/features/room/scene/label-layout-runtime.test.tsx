import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import * as placement from './label-layout';
import * as diagnosticModule from './label-layout-diagnostics';
import { createRoomLabelRegistry } from './label-layout-runtime';

const viewport = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 160,
  bottom: 100,
  width: 160,
  height: 100,
  toJSON() {},
};
let queue: FrameRequestCallback[];
let resize: ResizeObserverCallback;
function flush() {
  const pending = queue;
  queue = [];
  pending.forEach((callback) => callback(0));
}
function label(host: HTMLElement, tag: 'button' | 'span' = 'button') {
  const element = document.createElement(tag);
  const leader = document.createElement('span');
  host.append(element, leader);
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
    const [dx, dy] = element.style.transform
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map(Number) ?? [0, 0];
    return {
      ...viewport,
      left: 50 + dx,
      top: 30 + dy,
      right: 95 + dx,
      bottom: 48 + dy,
      width: 45,
      height: 18,
    };
  });
  return { element, leader };
}
beforeEach(() => {
  queue = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  Reflect.deleteProperty(window, '__roomLayoutDiagnosticsEnabled');
  Reflect.deleteProperty(window, '__roomLabelLayoutSnapshot');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('unified room label registry', () => {
  it('keeps collector overhead outside the solver deadline and measured solver interval', () => {
    window.__roomLayoutDiagnosticsEnabled = true;
    let now = 0;
    const createDiagnostics = diagnosticModule.createLabelLayoutDiagnostics;
    vi.spyOn(
      diagnosticModule,
      'createLabelLayoutDiagnostics',
    ).mockImplementation((target) => {
      const capture = createDiagnostics(target)!;
      return {
        ...capture,
        mark(...args) {
          // A deterministic stand-in for diagnostic validation/allocation.
          if (args[0] === 'solver-entry') now += 5;
          capture.mark(...args);
        },
      };
    });
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host);
    let actualSolverEntry = -1,
      actualSolverDeadline = -1;
    const packing = vi
      .spyOn(placement, 'layoutLabelsDetailed')
      .mockImplementation(
        (labels, _viewport, _reserved, allowance, solverClock) => {
          actualSolverEntry = solverClock!();
          actualSolverDeadline =
            actualSolverEntry + allowance!.maxMilliseconds!;
          now += 3;
          return {
            placements: labels.map(({ id }) => ({
              id,
              visible: true,
              dx: 0,
              dy: 0,
              compact: false,
            })),
            status: 'complete',
            stats: {
              operations: 1,
              candidates: 1,
              nodes: 0,
              backtracks: 0,
              elapsedMs: 3,
              greedyComplete: true,
            },
          };
        },
      );
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => now,
    });
    const cleanup = registry.connect(canvas);
    registry.register('shelf-1a', item.element, item.leader, { priority: 4 });
    flush();
    expect({
      entry: actualSolverEntry,
      deadline: actualSolverDeadline,
      elapsed:
        window.__roomLabelLayoutSnapshot!.runtime!.timing.solverElapsedMs,
    }).toEqual({ entry: 0, deadline: 16, elapsed: 3 });
    expect(packing).toHaveBeenCalledOnce();
    expect(window.__roomLabelLayoutSnapshot!.runtime).toMatchObject({
      terminal: 'complete',
      timing: { elapsedMs: 8, solverElapsedMs: 3 },
    });
    expect(
      window.__roomLabelLayoutSnapshot!.runtime!.timing.stages.filter(
        ({ stage }) => stage === 'solver-entry' || stage === 'solver-end',
      ),
    ).toMatchObject([
      { stage: 'solver-entry', elapsedMs: 0, remainingMilliseconds: 16 },
      { stage: 'solver-end', elapsedMs: 3 },
    ]);
    expect(item.element.dataset.labelSuppressed).toBe('false');
    cleanup();
  });
  it('records the whole runtime transaction and shared solver allowances across CSS passes', () => {
    window.__roomLayoutDiagnosticsEnabled = true;
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    let now = 100;
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => {
      expect(window.__roomLabelLayoutSnapshot).toMatchObject({
        transaction: 1,
        passes: [],
        complete: false,
        runtime: {
          terminal: 'pending',
          timing: { source: 'runtime', elapsedMs: 0 },
        },
      });
      return viewport;
    });
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.append(full);
    const rect = {
      ...viewport,
      left: 50,
      top: 30,
      right: 95,
      bottom: 48,
      width: 45,
      height: 18,
    };
    vi.mocked(item.element.getBoundingClientRect).mockImplementation(() => {
      now += 0.5;
      const dx = Number(item.element.dataset.labelDx ?? 0),
        dy = Number(item.element.dataset.labelDy ?? 0);
      return {
        ...rect,
        left: 50 + dx,
        right: 95 + dx,
        top: 30 + dy,
        bottom: 48 + dy,
      };
    });
    vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => {
      now += 0.5;
      return { ...viewport, width: 27, height: 32 };
    });
    let calls = 0;
    const packing = vi
      .spyOn(placement, 'layoutLabelsDetailed')
      .mockImplementation((labels) => {
        now += ++calls === 1 ? 2 : 3;
        return {
          placements: labels.map(({ id }) => ({
            id,
            visible: true,
            dx: 0,
            dy: 0,
            compact: true,
          })),
          status: 'complete',
          stats: {
            operations: calls === 1 ? 12 : 7,
            candidates: calls === 1 ? 4 : 2,
            nodes: 1,
            backtracks: 0,
            elapsedMs: calls === 1 ? 2 : 3,
            greedyComplete: true,
          },
        };
      });
    const clock = vi.fn(() => now);
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock,
    });
    const cleanup = registry.connect(canvas);
    registry.register('shelf-1a', item.element, item.leader, {
      priority: 4,
      mandatory: true,
      compact: true,
      locationCode: 'ITC-S1A',
    });
    flush();
    const snapshot = window.__roomLabelLayoutSnapshot!;
    expect(packing).toHaveBeenCalledTimes(2);
    expect(item.element.getBoundingClientRect).toHaveBeenCalledTimes(5);
    expect(full.getBoundingClientRect).toHaveBeenCalledTimes(4);
    expect(snapshot.runtime).toMatchObject({
      terminal: 'complete',
      timing: { source: 'runtime', elapsedMs: 9.5, solverElapsedMs: 5 },
    });
    const entries = snapshot.runtime!.timing.stages.filter(
      ({ stage }) => stage === 'solver-entry',
    );
    expect(entries).toEqual([
      {
        stage: 'solver-entry',
        pass: 1,
        elapsedMs: 1,
        remainingMilliseconds: 15,
        remainingOperations: 1_999_997,
        remainingCandidates: 50_000,
        remainingNodes: 4096,
        remainingInputs: 128,
        remainingCandidatesPerLabel: 4096,
      },
      {
        stage: 'solver-entry',
        pass: 2,
        elapsedMs: 5.5,
        remainingMilliseconds: 10.5,
        remainingOperations: 1_999_978,
        remainingCandidates: 49_996,
        remainingNodes: 4095,
        remainingInputs: 128,
        remainingCandidatesPerLabel: 4096,
      },
    ]);
    entries.forEach((entry, index) =>
      expect(packing.mock.calls[index][3]).toMatchObject({
        maxMilliseconds: entry.remainingMilliseconds,
        maxOperations: entry.remainingOperations,
        maxCandidates: entry.remainingCandidates,
        maxNodes: entry.remainingNodes,
      }),
    );
    expect(snapshot.runtime!.timing.stages.map(({ stage }) => stage)).toEqual([
      'initial-measurement-start',
      'initial-measurement-end',
      'solver-entry',
      'solver-end',
      'dom-application-start',
      'dom-application-end',
      'remeasurement-start',
      'remeasurement-end',
      'pass-measurement-start',
      'pass-measurement-end',
      'solver-entry',
      'solver-end',
      'dom-application-start',
      'dom-application-end',
      'remeasurement-start',
      'remeasurement-end',
      'terminal',
    ]);
    expect(snapshot.lastAttempt).toMatchObject({
      transaction: 1,
      terminal: 'complete',
      elapsedMs: 9.5,
      solverElapsedMs: 5,
      passCount: 2,
    });
    cleanup();
  });
  it('adds no clock calls, DOM reads, or solver calls with diagnostics disabled', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      clock = vi.fn(() => 0);
    const packing = vi
      .spyOn(placement, 'layoutLabelsDetailed')
      .mockImplementation((labels) => ({
        placements: labels.map(({ id }) => ({
          id,
          visible: true,
          dx: 0,
          dy: 0,
          compact: false,
        })),
        status: 'complete',
        stats: {
          operations: 1,
          candidates: 1,
          nodes: 0,
          backtracks: 0,
          elapsedMs: 0,
          greedyComplete: true,
        },
      }));
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock,
    });
    const cleanup = registry.connect(canvas);
    registry.register('shelf-1a', item.element, item.leader, { priority: 4 });
    flush();
    expect(clock).toHaveBeenCalledTimes(9);
    expect(item.element.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(packing).toHaveBeenCalledOnce();
    expect(window.__roomLabelLayoutSnapshot).toBeUndefined();
    cleanup();
  });
  it.each(['missing-host', 'unmeasured-viewport'] as const)(
    'publishes the %s terminal path from the runtime clock',
    (reason) => {
      window.__roomLayoutDiagnosticsEnabled = true;
      const canvas = document.createElement('canvas');
      if (reason === 'unmeasured-viewport') {
        const host = document.createElement('div');
        host.append(canvas);
        document.body.append(host);
      }
      let now = 7;
      vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => {
        now += 3;
        return reason === 'unmeasured-viewport'
          ? { ...viewport, width: 0 }
          : viewport;
      });
      const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
        clock: () => now,
      });
      const cleanup = registry.connect(canvas);
      flush();
      expect(window.__roomLabelLayoutSnapshot).toMatchObject({
        transaction: 1,
        complete: false,
        passes: [],
        failure: reason,
        runtime: {
          terminal: reason,
          timing: { source: 'runtime', elapsedMs: 3, solverElapsedMs: 0 },
        },
        lastAttempt: {
          transaction: 1,
          terminal: reason,
          elapsedMs: 3,
          passCount: 0,
        },
      });
      cleanup();
    },
  );

  it('retains the last actual failed diagnostic attempt on suppressed keys and retries a changed obstruction', () => {
    window.__roomLayoutDiagnosticsEnabled = true;
    const host = document.createElement('div'),
      canvas = document.createElement('canvas'),
      obstruction = document.createElement('div');
    host.dataset.roomSurface = 'true';
    obstruction.dataset.roomObstruction = 'true';
    host.append(canvas, obstruction);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    let obstacle = { ...viewport, left: 120, top: 0, right: 150, bottom: 50 };
    vi.spyOn(obstruction, 'getClientRects').mockImplementation(
      () => [obstacle] as unknown as DOMRectList,
    );
    vi.spyOn(obstruction, 'getBoundingClientRect').mockImplementation(
      () => obstacle,
    );
    const item = label(host);
    const packing = vi
      .spyOn(placement, 'layoutLabelsDetailed')
      .mockImplementation((labels) => ({
        placements: labels.map(({ id }) => ({
          id,
          visible: false,
          dx: 0,
          dy: 0,
        })),
        status: 'budget-exhausted',
        stats: {
          operations: 12,
          candidates: 4,
          nodes: 0,
          backtracks: 0,
          elapsedMs: 1,
          greedyComplete: false,
          exhaustion: { reason: 'per-label', phase: 'candidate-domain' },
        },
      }));
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => 0,
    });
    const cleanup = registry.connect(canvas);
    registry.register('shelf-1a', item.element, item.leader, {
      priority: 4,
      locationCode: 'ITC-S1A',
      mandatory: true,
    });
    flush();
    const snapshot = window.__roomLabelLayoutSnapshot;
    expect(snapshot).toMatchObject({
      transaction: 1,
      complete: true,
      settled: true,
      passes: [{}],
    });
    const revision = canvas.dataset.labelLayoutRevision;
    for (let i = 0; i < 3; i++) {
      registry.schedule();
      flush();
    }
    expect(packing).toHaveBeenCalledOnce();
    expect(window.__roomLabelLayoutSnapshot!.passes).toBe(snapshot!.passes);
    expect(window.__roomLabelLayoutSnapshot!.runtime).toBe(snapshot!.runtime);
    expect(window.__roomLabelLayoutSnapshot).toMatchObject({
      transaction: 1,
      passes: snapshot!.passes,
      runtime: snapshot!.runtime,
      lastAttempt: {
        transaction: 4,
        terminal: 'cached-suppression',
        cacheSourceTransaction: 1,
        passCount: 0,
      },
      recentTransactions: [
        { transaction: 1, terminal: 'budget-exhausted' },
        { transaction: 2, terminal: 'cached-suppression' },
        { transaction: 3, terminal: 'cached-suppression' },
        { transaction: 4, terminal: 'cached-suppression' },
      ],
    });
    expect(snapshot!.passes[0].solver).toMatchObject({
      status: 'budget-exhausted',
      stats: {
        nodes: 0,
        exhaustion: { reason: 'per-label', phase: 'candidate-domain' },
      },
    });
    expect(canvas.dataset.labelLayoutRevision).toBe(revision);
    expect(canvas.dataset.labelLayoutStatus).toBe('budget-exhausted');
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    obstacle = { ...obstacle, left: 121 };
    registry.schedule();
    flush();
    expect(packing).toHaveBeenCalledTimes(2);
    expect(window.__roomLabelLayoutSnapshot!.transaction).toBe(5);
    expect(window.__roomLabelLayoutSnapshot!.passes[0].reserved[0].left).toBe(
      121,
    );
    registry.retry();
    flush();
    expect(packing).toHaveBeenCalledTimes(3);
    expect(window.__roomLabelLayoutSnapshot!.transaction).toBe(6);
    expect(queue).toHaveLength(0);
    cleanup();
  });
  it('publishes an explicit actual measurement failure without a fabricated complete pass or revision', () => {
    window.__roomLayoutDiagnosticsEnabled = true;
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.append(full);
    let now = 0,
      slow = false;
    vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => {
      if (slow) now += 20;
      return { ...viewport, width: 27, height: 32 };
    });
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => now,
    });
    const cleanup = registry.connect(canvas);
    registry.register('shelf-1a', item.element, item.leader, {
      priority: 4,
      mandatory: true,
      locationCode: 'ITC-S1A',
    });
    flush();
    expect(window.__roomLabelLayoutSnapshot!.complete).toBe(true);
    const revision = canvas.dataset.labelLayoutRevision;
    slow = true;
    registry.schedule();
    flush();
    expect(window.__roomLabelLayoutSnapshot).toMatchObject({
      transaction: 2,
      complete: false,
      settled: false,
      passes: [],
      failure: 'measurement-budget',
      runtime: {
        terminal: 'measurement-budget',
        timing: {
          source: 'runtime',
          elapsedMs: 20,
          solverElapsedMs: 0,
          stages: [
            { stage: 'initial-measurement-start', elapsedMs: 0 },
            { stage: 'initial-measurement-end', elapsedMs: 20 },
            { stage: 'terminal', elapsedMs: 20 },
          ],
        },
      },
    });
    expect(window.__roomLabelLayoutSnapshot!.error).toBeUndefined();
    expect(canvas.dataset.labelLayoutRevision).toBe(revision);
    expect(canvas.dataset.labelLayoutStatus).toBe('budget-exhausted');
    expect(item.element).toHaveAttribute('aria-hidden', 'true');
    expect(item.element.tabIndex).toBe(-1);
    expect(queue).toHaveLength(0);
    cleanup();
  });

  it.each(['placement-budget', 'measurement-budget'] as const)(
    'records whole elapsed time at %s after solver work',
    (reason) => {
      window.__roomLayoutDiagnosticsEnabled = true;
      const host = document.createElement('div'),
        canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const item = label(host);
      let now = 0,
        reads = 0;
      vi.mocked(item.element.getBoundingClientRect).mockImplementation(() => {
        if (++reads > 1) now += 20;
        return {
          ...viewport,
          left: 50,
          top: 30,
          right: 95,
          bottom: 48,
          width: 45,
          height: 18,
        };
      });
      const packing = vi
        .spyOn(placement, 'layoutLabelsDetailed')
        .mockImplementation((labels) => {
          now += 1;
          return {
            placements:
              reason === 'placement-budget'
                ? []
                : labels.map(({ id }) => ({
                    id,
                    visible: true,
                    dx: 0,
                    dy: 0,
                    compact: false,
                  })),
            status: 'budget-exhausted',
            stats: {
              operations: 2,
              candidates: 1,
              nodes: 0,
              backtracks: 0,
              elapsedMs: 1,
              greedyComplete: false,
            },
          };
        });
      const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
        clock: () => now,
      });
      const cleanup = registry.connect(canvas);
      registry.register('shelf-1a', item.element, item.leader, { priority: 4 });
      flush();
      if (reason === 'measurement-budget') {
        expect(canvas.dataset.labelLayoutPending).toBe('true');
        expect(item.element).toHaveAttribute('aria-hidden', 'true');
        for (let frame = 0; frame < 4; frame++) flush();
      }
      const snapshot = window.__roomLabelLayoutSnapshot!;
      expect(snapshot).toMatchObject({
        complete: false,
        settled: false,
        failure: reason,
        runtime: {
          terminal: reason,
          timing: {
            source: 'runtime',
            elapsedMs: reason === 'placement-budget' ? 1 : 101,
            solverElapsedMs: 1,
          },
        },
        lastAttempt: { transaction: 1, terminal: reason, passCount: 1 },
      });
      expect(snapshot.runtime!.timing.stages.at(-1)).toMatchObject({
        stage: 'terminal',
        elapsedMs: reason === 'placement-budget' ? 1 : 101,
      });
      expect(packing).toHaveBeenCalledOnce();
      expect(item.element.getBoundingClientRect).toHaveBeenCalledTimes(
        reason === 'placement-budget' ? 1 : 6,
      );
      expect(item.element).toHaveAttribute('aria-hidden', 'true');
      expect(canvas.dataset.labelLayoutPending).toBe('false');
      cleanup();
    },
  );
  it('physical pick reservation keeps its own label off the current exposed mesh point', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      reservation = { left: 66.5, top: 33, right: 78.5, bottom: 45 };
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => 0,
    });
    const cleanup = registry.connect(canvas);
    registry.register('self', item.element, item.leader, {
      priority: 4,
      mandatory: true,
      locationCode: 'ITC-RED',
      pickReservation: () => reservation,
    });
    item.element.focus();
    flush();
    expect(item.element.dataset.labelSuppressed).toBe('false');
    expect(item.element).toHaveFocus();
    const actual = item.element.getBoundingClientRect();
    expect(
      actual.right + 3 <= reservation.left ||
        actual.left >= reservation.right + 3 ||
        actual.bottom + 3 <= reservation.top ||
        actual.top >= reservation.bottom + 3,
    ).toBe(true);
    cleanup();
  });
  it('physical pick reservation survives same-code action dedup and remains shared by tooltip labels', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const anchor = label(host),
      tooltip = label(host),
      reservation = { left: 66.5, top: 33, right: 78.5, bottom: 45 };
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => 0,
    });
    const cleanup = registry.connect(canvas);
    registry.register('anchor', anchor.element, anchor.leader, {
      priority: 4,
      locationCode: 'ITC-RED',
      pickReservation: () => reservation,
    });
    registry.register('tooltip', tooltip.element, tooltip.leader, {
      priority: 4,
      locationCode: 'ITC-RED',
    });
    tooltip.element.focus();
    const packing = vi.spyOn(placement, 'layoutLabelsDetailed');
    flush();
    expect(tooltip.element.dataset.labelSuppressed).toBe('false');
    expect(anchor.element.dataset.labelSuppressed).toBe('true');
    expect(packing.mock.calls[0][2]).toContainEqual(reservation);
    const actual = tooltip.element.getBoundingClientRect();
    expect(
      actual.right + 3 <= reservation.left ||
        actual.left >= reservation.right + 3 ||
        actual.bottom + 3 <= reservation.top ||
        actual.top >= reservation.bottom + 3,
    ).toBe(true);
    cleanup();
  });
  it('physical pick reservation refreshes failed measurements on movement and removes hidden anchors', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host);
    let reservation = { left: 66, top: 33, right: 78, bottom: 45 },
      exposed = true;
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => 0,
      limits: { maxInputs: 0 },
    });
    const cleanup = registry.connect(canvas),
      packing = vi.spyOn(placement, 'layoutLabelsDetailed');
    registry.register('moving', item.element, item.leader, {
      priority: 4,
      mandatory: true,
      locationCode: 'ITC-RED',
      isVisible: () => exposed,
      pickReservation: () => reservation,
    });
    flush();
    expect(packing).toHaveBeenCalledOnce();
    registry.schedule();
    flush();
    expect(packing).toHaveBeenCalledOnce();
    reservation = { left: 106, top: 33, right: 118, bottom: 45 };
    registry.schedule();
    flush();
    expect(packing).toHaveBeenCalledTimes(2);
    expect(packing.mock.lastCall?.[2]).toContainEqual(reservation);
    exposed = false;
    registry.schedule();
    flush();
    expect(packing.mock.lastCall?.[2]).toEqual([]);
    cleanup();
  });
  it('keeps the selected mandatory anchor while retaining focused and occluded-anchor tooltip fallback', () => {
    const surface = document.createElement('div'),
      host = document.createElement('div'),
      canvas = document.createElement('canvas');
    surface.dataset.roomSurface = 'true';
    host.append(canvas);
    surface.append(host);
    document.body.append(surface);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const anchored = label(host),
      tooltip = label(surface);
    let exposed = true;
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    registry.register('hover-tooltip', tooltip.element, tooltip.leader, {
      priority: 4,
      locationCode: 'ITC-RACK',
    });
    registry.register('server-rack', anchored.element, anchored.leader, {
      priority: 4,
      mandatory: true,
      locationCode: 'ITC-RACK',
      isVisible: () => exposed,
    });
    const assertOwner = (owner: typeof anchored, hidden: typeof anchored) => {
      expect(owner.element.dataset.labelSuppressed).toBe('false');
      expect(owner.element).not.toHaveAttribute('aria-hidden');
      expect(owner.element.tabIndex).toBe(0);
      expect(hidden.element.dataset.labelSuppressed).toBe('true');
      expect(hidden.element).toHaveAttribute('aria-hidden', 'true');
      expect(hidden.element.tabIndex).toBe(-1);
    };
    flush();
    assertOwner(anchored, tooltip);
    exposed = false;
    registry.schedule();
    flush();
    assertOwner(tooltip, anchored);
    // Focus only the live fallback, then restore the anchored action. Its
    // recovery must preserve that existing keyboard interaction until blur.
    tooltip.element.focus();
    exposed = true;
    registry.schedule();
    flush();
    assertOwner(tooltip, anchored);
    expect(tooltip.element).toHaveFocus();
    tooltip.element.blur();
    registry.schedule();
    flush();
    assertOwner(anchored, tooltip);
    cleanup();
  });
  it('refreshes cached scene exposure after viewport movement and overlay placement without camera motion', () => {
    const surface = document.createElement('div'),
      host = document.createElement('div'),
      canvas = document.createElement('canvas');
    surface.dataset.roomSurface = 'true';
    host.append(canvas);
    surface.append(host);
    document.body.append(surface);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host);
    let overlayCoversTarget = true,
      exposed = false;
    const invalidate = vi.fn(() => {
      // A demand frame refreshes the measured mask before label placement.
      exposed = !overlayCoversTarget;
    });
    const visual = new EventTarget();
    vi.stubGlobal('visualViewport', visual);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas, invalidate);
    registry.register('location', item.element, item.leader, {
      priority: 1,
      locationCode: 'ITC-S4C',
      isVisible: () => exposed,
    });
    flush();
    expect(item.element.dataset.roomExposed).toBe('false');
    invalidate.mockClear();
    overlayCoversTarget = false;
    host.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(invalidate).toHaveBeenCalledOnce();
    flush();
    expect(item.element.dataset.roomExposed).toBe('true');
    expect(item.element.dataset.labelSuppressed).toBe('false');
    overlayCoversTarget = true;
    registry.invalidateLayout();
    flush();
    expect(item.element.dataset.roomExposed).toBe('false');
    expect(item.element.tabIndex).toBe(-1);
    overlayCoversTarget = false;
    registry.invalidateLayout();
    flush();
    expect(item.element.dataset.roomExposed).toBe('true');
    overlayCoversTarget = true;
    visual.dispatchEvent(new Event('resize'));
    flush();
    expect(item.element.dataset.roomExposed).toBe('false');
    overlayCoversTarget = false;
    visual.dispatchEvent(new Event('scroll'));
    flush();
    expect(item.element.dataset.roomExposed).toBe('true');
    cleanup();
    invalidate.mockClear();
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    visual.dispatchEvent(new Event('resize'));
    registry.invalidateLayout();
    expect(invalidate).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
  });

  it('shares one deadline and operation allowance across centered reflow passes', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.append(full);
    let now = 0;
    vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => {
      now += 1;
      return { ...viewport, width: 27, height: 32 };
    });
    const packing = vi
      .spyOn(placement, 'layoutLabelsDetailed')
      .mockImplementation((labels) => {
        now += 5;
        return {
          placements: labels.map(({ id }) => ({
            id,
            visible: true,
            dx: 0,
            dy: 0,
            compact: true,
          })),
          status: 'complete',
          stats: {
            operations: 200,
            candidates: 12,
            nodes: 2,
            backtracks: 0,
            elapsedMs: 5,
            greedyComplete: true,
          },
        };
      });
    const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
      clock: () => now,
      limits: { maxOperations: 1000, maxMilliseconds: 100 },
    });
    const cleanup = registry.connect(canvas);
    registry.register('shared', item.element, item.leader, {
      priority: 3,
      compact: true,
      mandatory: true,
    });
    flush();
    expect(packing).toHaveBeenCalledTimes(2);
    const first = packing.mock.calls[0][3]!,
      second = packing.mock.calls[1][3]!;
    expect(second.maxMilliseconds).toBeLessThan(first.maxMilliseconds! - 5);
    expect(second.maxOperations).toBeLessThan(first.maxOperations! - 200);
    expect(second.maxCandidates).toBe(first.maxCandidates! - 12);
    expect(second.maxNodes).toBe(first.maxNodes! - 2);
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(queue).toHaveLength(0);
    cleanup();
  });
  it('counts DOM remeasurement, blurs before concealment, and publishes only after fresh validation', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.append(full);
    let now = 0,
      slow = false;
    vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => {
      if (slow) now += 9;
      return { ...viewport, width: 27, height: 32 };
    });
    const issues = vi.fn(),
      registry = createRoomLabelRegistry(vi.fn(), undefined, issues, {
        clock: () => now,
      });
    const cleanup = registry.connect(canvas);
    registry.register('deadline', item.element, item.leader, {
      priority: 4,
      locationCode: 'ITC-S1A',
      mandatory: true,
    });
    flush();
    const revision = Number(canvas.dataset.labelLayoutRevision);
    item.element.focus();
    const blur = vi.fn(() =>
      expect(item.element.style.visibility).toBe('visible'),
    );
    item.element.addEventListener('blur', blur);
    slow = true;
    registry.schedule();
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    flush();
    expect(blur).toHaveBeenCalledOnce();
    expect(item.element).toHaveAttribute('aria-hidden', 'true');
    expect(item.element.tabIndex).toBe(-1);
    expect(issues).not.toHaveBeenCalled();
    expect(canvas.dataset.labelLayoutError).toBeUndefined();
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    expect(canvas.dataset.labelLayoutRevision).toBe(String(revision));
    expect(item.element.style.visibility).toBe('hidden');
    expect(item.element.style.pointerEvents).toBe('none');
    expect(item.leader.style.display).toBe('none');
    expect(queue).toHaveLength(1);
    flush();
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(canvas.dataset.labelLayoutStatus).toBe('complete');
    expect(canvas.dataset.labelLayoutError).toBeUndefined();
    expect(canvas.dataset.labelLayoutRevision).toBe(String(revision + 1));
    expect(item.element).not.toHaveAttribute('aria-hidden');
    expect(item.element.tabIndex).toBe(0);
    expect(item.element.style.visibility).toBe('visible');
    expect(item.element.style.pointerEvents).toBe('auto');
    expect(item.element).not.toHaveFocus();
    expect(blur).toHaveBeenCalledOnce();
    expect(issues).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
    cleanup();
  });
  it.each(['candidate-infeasible', 'budget-exhausted'] as const)(
    'latches %s for the same measurement and retries only explicitly or after view changes',
    (status) => {
      const host = document.createElement('div'),
        canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      let bounds = viewport;
      vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(
        () => bounds,
      );
      const item = label(host),
        issues = vi.fn();
      const packing = vi
        .spyOn(placement, 'layoutLabelsDetailed')
        .mockImplementation((labels) => ({
          placements: labels.map(({ id }) => ({
            id,
            visible: false,
            dx: 0,
            dy: 0,
          })),
          status,
          stats: {
            operations: 1,
            candidates: 0,
            nodes: 0,
            backtracks: 0,
            elapsedMs: 0,
            greedyComplete: false,
          },
        }));
      const registry = createRoomLabelRegistry(vi.fn(), undefined, issues, {
          clock: () => 0,
        }),
        cleanup = registry.connect(canvas);
      registry.register('unplaced', item.element, item.leader, {
        priority: 4,
        locationCode: 'ITC-S1A',
        mandatory: true,
      });
      flush();
      expect(issues).toHaveBeenCalledExactlyOnceWith(['ITC-S1A']);
      expect(canvas.dataset.labelLayoutStatus).toBe(status);
      for (let frame = 0; frame < 3; frame++) {
        registry.schedule();
        flush();
      }
      expect(packing).toHaveBeenCalledOnce();
      expect(queue).toHaveLength(0);
      registry.retry();
      flush();
      expect(packing).toHaveBeenCalledTimes(2);
      bounds = { ...viewport, right: 170, width: 170 };
      registry.schedule();
      flush();
      expect(packing).toHaveBeenCalledTimes(3);
      cleanup();
    },
  );
  it.each(['exposure', 'ancestor visibility'])(
    'blurs a focused action before hiding it after losing %s and stops keyboard activation',
    async (reason) => {
      const host = document.createElement('div'),
        canvas = document.createElement('canvas'),
        wrapper = document.createElement('div');
      host.append(canvas, wrapper);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const item = label(wrapper),
        activate = vi.fn(),
        blurred = vi.fn();
      item.element.addEventListener('click', activate);
      item.element.addEventListener('blur', () => {
        blurred({
          visibility: item.element.style.visibility,
          hidden: item.element.getAttribute('aria-hidden'),
          exposed: item.element.dataset.roomExposed,
        });
      });
      let exposed = true;
      const registry = createRoomLabelRegistry(vi.fn()),
        cleanup = registry.connect(canvas);
      registry.register('focused', item.element, item.leader, {
        priority: 4,
        locationCode: 'ITC-S1A',
        isVisible: () => exposed,
      });
      flush();
      item.element.focus();
      const user = userEvent.setup();
      await user.keyboard('{Enter}');
      expect(activate).toHaveBeenCalledOnce();
      if (reason === 'exposure') exposed = false;
      else wrapper.style.visibility = 'hidden';
      registry.schedule();
      flush();
      expect(blurred).toHaveBeenCalledExactlyOnceWith({
        visibility: 'visible',
        hidden: null,
        exposed: 'true',
      });
      expect(document.body).toHaveFocus();
      expect(item.element).toHaveAttribute('aria-hidden', 'true');
      expect(item.element.tabIndex).toBe(-1);
      expect(item.element.style.visibility).toBe('hidden');
      expect(item.element.style.pointerEvents).toBe('none');
      await user.keyboard('{Enter} ');
      expect(activate).toHaveBeenCalledOnce();
      cleanup();
    },
  );
  it('observes exact inputs before placement without changing registry output or scheduling', () => {
    const original = placement.layoutLabelsDetailed;
    let enabled = false;
    const spy = vi
      .spyOn(placement, 'layoutLabelsDetailed')
      .mockImplementation((labels, bounds, reserved, limits, clock) => {
        if (enabled) {
          expect(window.__roomLabelLayoutSnapshot!.passes.at(-1)).toEqual({
            labels,
            viewport: {
              left: bounds.left,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
            },
            reserved: reserved?.map((area) => ({
              left: area.left,
              top: area.top,
              right: area.right,
              bottom: area.bottom,
            })),
          });
        }
        return original(labels, bounds, reserved, limits, clock);
      });
    const run = () => {
      const host = document.createElement('div'),
        canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const item = label(host),
        suppression = vi.fn();
      const registry = createRoomLabelRegistry(suppression),
        cleanup = registry.connect(canvas);
      registry.register('shelf-1a', item.element, item.leader, {
        priority: 3,
        locationCode: 'ITC-S1A',
        mandatory: true,
        compact: true,
      });
      flush();
      const result = {
        html: item.element.outerHTML,
        leader: item.leader.outerHTML,
        pendingFrames: queue.length,
        calls: suppression.mock.calls,
      };
      cleanup();
      host.remove();
      return result;
    };
    const ordinary = run();
    expect(window.__roomLabelLayoutSnapshot).toBeUndefined();
    Object.defineProperty(window, '__roomLayoutDiagnosticsEnabled', {
      value: true,
      configurable: true,
    });
    enabled = true;
    expect(run()).toEqual(ordinary);
    expect(window.__roomLabelLayoutSnapshot).toMatchObject({
      complete: true,
      settled: true,
    });
    expect(spy).toHaveBeenCalled();
  });
  it('keeps placement pending through actual centered full/compact CSS measurement and preserves focused neighbors', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const measured: { compact: boolean; pending: string | undefined }[] = [];
    const make = (left: number) => {
      const item = label(host),
        full = document.createElement('span');
      full.dataset.roomLabelFull = 'true';
      item.element.append(full);
      vi.spyOn(full, 'getBoundingClientRect').mockReturnValue({
        ...viewport,
        width: 122,
        height: 32,
      });
      vi.mocked(item.element.getBoundingClientRect).mockImplementation(() => {
        const compact = item.element.dataset.labelCompact === 'true';
        measured.push({ compact, pending: canvas.dataset.labelLayoutPending });
        const width = compact ? 44 : 140,
          height = 44;
        const dx = Number(item.element.dataset.labelDx ?? 0),
          dy = Number(item.element.dataset.labelDy ?? 0);
        // Html center translates by half the changing button dimensions.
        const x = left + (140 - width) / 2 + dx,
          y = 28 + dy;
        return {
          ...viewport,
          left: x,
          right: x + width,
          top: y,
          bottom: y + height,
          width,
          height,
        };
      });
      return item;
    };
    const a = make(70),
      b = make(78),
      registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    const options = {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'A',
    };
    const unregister = registry.register('a', a.element, a.leader, options);
    registry.register('b', b.element, b.leader, {
      ...options,
      locationCode: 'B',
    });
    a.element.focus();
    flush();
    expect(
      measured.every((measurement) => measurement.pending === 'true'),
    ).toBe(true);
    expect(measured.some((measurement) => measurement.compact)).toBe(true);
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    const first = a.element.getBoundingClientRect(),
      neighbor = b.element.getBoundingClientRect();
    for (const rect of [first, neighbor]) {
      expect(rect.left).toBeGreaterThanOrEqual(2);
      expect(rect.right).toBeLessThanOrEqual(158);
      expect(rect.width).toBe(44);
    }
    expect(
      first.right + 3 <= neighbor.left ||
        neighbor.right + 3 <= first.left ||
        first.bottom + 3 <= neighbor.top ||
        neighbor.bottom + 3 <= first.top,
    ).toBe(true);
    unregister();
    registry.register('a', a.element, a.leader, {
      ...options,
      preferFull: true,
      inspection: 'focus',
    });
    flush();
    expect(a.element).toHaveFocus();
    expect(b.element.getBoundingClientRect()).toEqual(neighbor);
    expect(queue).toHaveLength(0);
    cleanup();
  });
  it('retains a displaced marker across effect cleanup and focus registration without moving its neighbor', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const a = label(host),
      b = label(host);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    registry.register('a', a.element, a.leader, {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'A',
    });
    const options = {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'B',
    };
    const unregister = registry.register('b', b.element, b.leader, options);
    flush();
    const displaced = b.element.dataset.labelDx;
    expect(displaced).not.toBe('0');
    // Camera geometry changes leave the previous B placement valid while its
    // old preferred pixel becomes free. Focus must still retain that placement.
    vi.mocked(a.element.getBoundingClientRect).mockReturnValue({
      ...viewport,
      left: 110,
      top: 30,
      right: 154,
      bottom: 74,
      width: 44,
      height: 44,
    });
    unregister();
    registry.register('b', b.element, b.leader, {
      ...options,
      preferFull: true,
      inspection: 'focus',
    });
    flush();
    expect(b.element.dataset.labelDx).toBe(displaced);
    expect(a.element.dataset.labelDx).toBe('0');
    expect(a.element.dataset.labelSuppressed).toBe('false');
    expect(b.element.dataset.labelSuppressed).toBe('false');
    cleanup();
  });
  it('supplies a quiet readable focused summary when full text would displace another occupied action', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const first = label(host),
      second = label(host);
    const full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    first.element.append(full);
    vi.spyOn(full, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      width: 140,
      height: 44,
    });
    const summary = vi.fn();
    const registry = createRoomLabelRegistry(vi.fn(), summary);
    const cleanup = registry.connect(canvas);
    const text = 'Long drawer name (ITC-D01) · 1 product / 31 units / 2 assets';
    const options = {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'ITC-D01',
      preferFull: true,
      inspection: 'focus' as const,
      readableSummary: text,
    };
    registry.register('first', first.element, first.leader, options);
    registry.register('second', second.element, second.leader, {
      priority: 3,
      mandatory: true,
      compact: true,
      locationCode: 'ITC-D02',
    });
    flush();
    expect(first.element.dataset.labelCompact).toBe('true');
    expect(second.element.dataset.labelSuppressed).toBe('false');
    expect(summary).toHaveBeenCalledExactlyOnceWith(text);
    registry.schedule();
    flush();
    expect(summary).toHaveBeenCalledOnce();
    registry.register('first', first.element, first.leader, {
      ...options,
      inspection: null,
      preferFull: false,
    });
    flush();
    expect(summary).toHaveBeenLastCalledWith(null);
    cleanup();
  });
  it('marks camera/layout work pending synchronously and settles one revision per bounded placement', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    flush();
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(canvas.dataset.labelLayoutRevision).toBe('1');
    registry.schedule();
    registry.schedule();
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    expect(queue).toHaveLength(1);
    flush();
    expect(canvas.dataset.labelLayoutRevision).toBe('2');
    expect(queue).toHaveLength(0);
    cleanup();
    expect(canvas.dataset.labelLayoutPending).toBeUndefined();
  });
  it('passes only a native-hit-confirmed pointer witness with the actual physical action bounds', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      child = document.createElement('span');
    item.element.append(child);
    const layout = vi.spyOn(placement, 'layoutLabelsDetailed');
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      'elementFromPoint',
    );
    const hit = vi.fn(() => child as Element);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hit,
    });
    const registry = createRoomLabelRegistry(vi.fn()),
      cleanup = registry.connect(canvas);
    try {
      registry.register('hover', item.element, item.leader, {
        priority: 3,
        mandatory: true,
        inspection: 'hover',
        pointer: () => ({ x: 60, y: 35 }),
      });
      flush();
      expect(layout.mock.lastCall?.[0][0].pointer).toEqual({
        x: 60,
        y: 35,
        bounds: { left: 50, top: 30, right: 95, bottom: 48 },
      });
      hit.mockReturnValue(document.body);
      registry.schedule();
      flush();
      expect(layout.mock.lastCall?.[0][0].pointer).toBeUndefined();
    } finally {
      cleanup();
      if (descriptor)
        Object.defineProperty(document, 'elementFromPoint', descriptor);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
  it('fits a selected occupied name and count row into its measured 44px action', () => {
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      height: 48,
      bottom: 48,
    });
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.dataset.roomOccupied = 'true';
    item.element.append(full);
    vi.spyOn(full, 'getBoundingClientRect').mockReturnValue({
      ...viewport,
      width: 122,
      height: 36,
    });
    const registry = createRoomLabelRegistry(vi.fn()),
      cleanup = registry.connect(canvas);
    registry.register('selected-occupied', item.element, item.leader, {
      priority: 4,
      mandatory: true,
    });
    flush();
    expect(item.element.dataset.labelSuppressed).toBe('false');
    expect(item.element.dataset.labelCompact).toBe('false');
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    cleanup();
  });
  it.each([
    { dimension: 'width', delta: 3 / 65536, settles: true },
    { dimension: 'height', delta: 3 / 65536, settles: true },
    { dimension: 'width', delta: 0.01, settles: false },
    { dimension: 'height', delta: 18, settles: false },
  ] as const)(
    'bounds translation noise for $dimension delta $delta without accepting real reflow',
    ({ dimension, delta, settles }) => {
      const host = document.createElement('div'),
        canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const item = label(host),
        full = document.createElement('span');
      full.dataset.roomLabelFull = 'true';
      item.element.append(full);
      let reads = 0;
      vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => ({
        ...viewport,
        width: 40,
        height: 32,
        [dimension]:
          (dimension === 'width' ? 40 : 32) + (++reads % 2 ? delta : 0),
      }));
      const registry = createRoomLabelRegistry(vi.fn()),
        cleanup = registry.connect(canvas);
      registry.register('fractional', item.element, item.leader, {
        priority: 4,
        mandatory: true,
      });
      flush();
      // Both success and terminal instability finish their bounded work.
      expect(canvas.dataset.labelLayoutPending).toBe('false');
      expect(reads).toBe(settles ? 2 : 8);
      expect(queue).toHaveLength(0);
      if (settles) {
        expect(canvas.dataset.labelLayoutError).toBeUndefined();
        expect(canvas.dataset.labelLayoutStatus).toBe('complete');
        expect(item.element.dataset.labelSuppressed).toBe('false');
      } else {
        expect(canvas.dataset.labelLayoutError).toMatch(
          /four placement passes/,
        );
        expect(canvas.dataset.labelLayoutStatus).toBe('budget-exhausted');
        expect(canvas.dataset.labelLayoutRevision).toBeUndefined();
        expect(item.element.dataset.labelSuppressed).toBe('true');
        expect(item.element.style.visibility).toBe('hidden');
        expect(item.element.style.pointerEvents).toBe('none');
        expect(item.element.tabIndex).toBe(-1);
        expect(item.element).toHaveAttribute('aria-hidden', 'true');
        expect(item.leader.style.display).toBe('none');
      }
      cleanup();
    },
  );
  it('fails explicitly at the synchronous remeasurement bound instead of publishing unstable placement', () => {
    window.__roomLayoutDiagnosticsEnabled = true;
    const host = document.createElement('div'),
      canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const item = label(host),
      full = document.createElement('span');
    full.dataset.roomLabelFull = 'true';
    item.element.append(full);
    let reads = 0;
    vi.spyOn(full, 'getBoundingClientRect').mockImplementation(() => ({
      ...viewport,
      width: ++reads % 2 ? 40 : 41,
      height: 18,
    }));
    const notify = vi.fn(),
      registry = createRoomLabelRegistry(notify, undefined, undefined, {
        clock: () => 0,
      }),
      cleanup = registry.connect(canvas);
    registry.register('shelf-1a', item.element, item.leader, {
      priority: 4,
      mandatory: true,
    });
    flush();
    expect(reads).toBe(8);
    expect(window.__roomLabelLayoutSnapshot).toMatchObject({
      failure: 'unstable-dimensions',
      lastAttempt: { passCount: 4 },
    });
    expect(
      window.__roomLabelLayoutSnapshot!.runtime!.timing.stages,
    ).toHaveLength(33);
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(canvas.dataset.labelLayoutStatus).toBe('budget-exhausted');
    expect(canvas.dataset.labelLayoutError).toMatch(/four placement passes/);
    expect(canvas.dataset.labelLayoutRevision).toBeUndefined();
    expect(item.element.dataset.labelSuppressed).toBe('true');
    expect(item.element.style.visibility).toBe('hidden');
    expect(item.element.style.pointerEvents).toBe('none');
    expect(item.element.tabIndex).toBe(-1);
    expect(item.element).toHaveAttribute('aria-hidden', 'true');
    expect(item.leader.style.display).toBe('none');
    expect(notify).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
    vi.mocked(full.getBoundingClientRect).mockReturnValue({
      ...viewport,
      width: 40,
      height: 18,
    });
    registry.schedule();
    expect(canvas.dataset.labelLayoutPending).toBe('true');
    expect(queue).toHaveLength(1);
    flush();
    expect(canvas.dataset.labelLayoutPending).toBe('false');
    expect(canvas.dataset.labelLayoutStatus).toBe('complete');
    expect(canvas.dataset.labelLayoutError).toBeUndefined();
    expect(item.element.dataset.labelSuppressed).toBe('false');
    expect(item.element.style.pointerEvents).toBe('auto');
    expect(item.element.tabIndex).toBe(0);
    expect(item.element).not.toHaveAttribute('aria-hidden');
    expect(notify).toHaveBeenCalledOnce();
    expect(queue).toHaveLength(0);
    cleanup();
  });
  it('remeasures after font readiness and font changes, then removes that subscription', async () => {
    const previous = Object.getOwnPropertyDescriptor(document, 'fonts');
    const fonts = Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: fonts,
    });
    try {
      const host = document.createElement('div');
      const canvas = document.createElement('canvas');
      host.append(canvas);
      document.body.append(host);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
      const registry = createRoomLabelRegistry(vi.fn());
      const cleanup = registry.connect(canvas);
      flush();
      await Promise.resolve();
      expect(queue).toHaveLength(1);
      flush();
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(queue).toHaveLength(1);
      flush();
      expect(queue).toHaveLength(0);
      cleanup();
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(queue).toHaveLength(0);
    } finally {
      if (previous) Object.defineProperty(document, 'fonts', previous);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });
  it('measures external hover and anchored text together, deduplicates and settles after resize', () => {
    const surface = document.createElement('div');
    surface.dataset.roomSurface = 'true';
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    surface.append(host);
    document.body.append(surface);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const anchored = label(host);
    const hover = label(surface);
    const decorative = label(host, 'span');
    const notify = vi.fn();
    const registry = createRoomLabelRegistry(notify);
    const cleanup = registry.connect(canvas);
    registry.register('anchored', anchored.element, anchored.leader, {
      priority: 1,
      locationCode: 'ITC-D01',
    });
    registry.register('hover', hover.element, hover.leader, {
      priority: 2,
      locationCode: 'ITC-D01',
    });
    registry.register('door', decorative.element, decorative.leader, {
      priority: 0,
      interactive: false,
    });
    registry.schedule();
    registry.schedule();
    expect(queue).toHaveLength(1);
    anchored.element.focus();
    flush();
    expect(anchored.element.dataset.labelSuppressed).toBe('false');
    expect(anchored.element).toHaveFocus();
    expect(hover.element.dataset.labelSuppressed).toBe('true');
    anchored.element.blur();
    registry.schedule();
    flush();
    expect(anchored.element.dataset.labelSuppressed).toBe('true');
    expect(anchored.element).toHaveAttribute('aria-hidden', 'true');
    expect(anchored.element.tabIndex).toBe(-1);
    expect(anchored.element.style.pointerEvents).toBe('none');
    expect(anchored.element).not.toHaveFocus();
    expect(hover.element.dataset.labelSuppressed).toBe('false');
    expect(decorative.element.tabIndex).toBe(-1);
    expect(decorative.leader.style.display).toBe('block');
    expect(queue).toHaveLength(0);
    resize([], {} as ResizeObserver);
    flush();
    expect(queue).toHaveLength(0);
    expect(notify).toHaveBeenCalledOnce();
    cleanup();
  });
  it('keeps occluded text unavailable and does not let an old ref cleanup remove its replacement', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
    const old = label(host);
    const current = label(host);
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    host.append(hidden);
    const occluded = label(hidden);
    const registry = createRoomLabelRegistry(vi.fn());
    const cleanup = registry.connect(canvas);
    const unregister = registry.register('location', old.element, old.leader, {
      priority: 1,
    });
    registry.register('location', current.element, current.leader, {
      priority: 3,
    });
    unregister();
    registry.register('hidden', occluded.element, occluded.leader, {
      priority: 3,
    });
    flush();
    expect(current.element.dataset.labelSuppressed).toBe('false');
    expect(occluded.element.dataset.labelSuppressed).toBe('true');
    expect(occluded.element.tabIndex).toBe(-1);
    expect(occluded.element).toHaveAttribute('aria-hidden', 'true');
    cleanup();
  });
});
