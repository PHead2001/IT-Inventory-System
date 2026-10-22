import capturedTransition from '../../../../tests/fixtures/room/selected-footprint-transition.json';
import capturedActive from '../../../../tests/fixtures/room/more-active-labels.json';
import capturedSelected from '../../../../tests/fixtures/room/more-selected-labels.json';
import capturedMore from '../../../../tests/fixtures/room/more-labels.json';
import { describe, expect, it } from 'vitest';
import {
  LABEL_PACKING_BUDGET,
  layoutLabels,
  layoutLabelsDetailed,
  type LabelRect,
  type LabelArea,
  type LabelPlacement,
} from './label-layout';

const viewport = { left: 0, top: 0, right: 160, bottom: 100 };
const label = (
  id: string,
  left: number,
  top: number,
  selected = false,
): LabelRect => ({
  id,
  left,
  top,
  width: 45,
  height: 18,
  selected,
});

describe('scene label placement', () => {
  it.each(['focused', 'hovered', 'mandatory'] as const)(
    'treats omitted %s as false when choosing one same-code action',
    (flag) => {
      for (const inactive of [undefined, false]) {
        const active = {
          ...label('z-active', 30, 30),
          locationCode: 'ITC-RACK',
          [flag]: true,
        };
        const other = {
          ...label('a-inactive', 80, 30),
          locationCode: 'ITC-RACK',
          [flag]: inactive,
        };
        const result = layoutLabelsDetailed([other, active], viewport);
        expect(result.status).toBe('complete');
        expect(
          result.placements
            .filter((entry) => entry.visible)
            .map((entry) => entry.id),
        ).toEqual(['z-active']);
      }
    },
  );
  it('keeps the mandatory selected anchor ahead of its same-code tooltip', () => {
    // Sanitized exact hosted rack failure: both rectangles fit without overlap,
    // but an omitted optional mandatory flag must compare as false, not NaN.
    const rack: LabelRect = {
      id: 'server-rack',
      locationCode: 'ITC-RACK',
      selected: true,
      priority: 4,
      mandatory: true,
      focused: false,
      hovered: false,
      left: 483.65625,
      top: 614.318359375,
      width: 200.6875,
      height: 48,
    };
    const tooltip: LabelRect = {
      id: 'hover-tooltip',
      locationCode: 'ITC-RACK',
      selected: true,
      priority: 4,
      focused: false,
      hovered: false,
      left: 596,
      top: 702,
      width: 92.375,
      height: 44,
      previous: { dx: 0, dy: 0, compact: false },
    };
    const view = {
      left: 286,
      top: 463.859375,
      right: 882,
      bottom: 1011.859375,
    };
    for (const mandatory of [undefined, false]) {
      for (const input of [
        [rack, { ...tooltip, mandatory }],
        [{ ...tooltip, mandatory }, rack],
      ]) {
        const result = layoutLabelsDetailed(input, view);
        expect(result.status).toBe('complete');
        expect(result.placements.filter((entry) => entry.visible)).toEqual([
          { id: 'server-rack', visible: true, dx: 0, dy: 0 },
        ]);
      }
    }
  });
  function assertPacking(
    input: LabelRect[],
    placements: LabelPlacement[],
    viewport: LabelArea,
    reserved: LabelArea[] = [],
  ) {
    const areas = placements
      .filter((entry) => entry.visible)
      .map((entry) => {
        const source = input.find((label) => label.id === entry.id)!;
        const size = entry.compact ? source.compact! : source;
        return {
          left: source.left + entry.dx,
          top: source.top + entry.dy,
          right: source.left + entry.dx + size.width,
          bottom: source.top + entry.dy + size.height,
        };
      });
    for (const [index, area] of areas.entries()) {
      expect(area.left).toBeGreaterThanOrEqual(viewport.left + 2);
      expect(area.top).toBeGreaterThanOrEqual(viewport.top + 2);
      expect(area.right).toBeLessThanOrEqual(viewport.right - 2);
      expect(area.bottom).toBeLessThanOrEqual(viewport.bottom - 2);
      for (const other of [...reserved, ...areas.slice(index + 1)])
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
    }
  }
  it.each(['focused', 'hovered'] as const)(
    'does not pin or expand a %s action across any physical pick reservation',
    (inspection) => {
      const input: LabelRect[] = [
        {
          ...label('selected', 100, 100, true),
          width: 200,
          height: 48,
          mandatory: true,
          previous: { dx: 0, dy: 0, compact: false },
          [inspection]: true,
          preferFull: true,
        },
        {
          ...label('neighbor', 100, 200),
          width: 200,
          height: 48,
          mandatory: true,
          compact: { width: 44, height: 44 },
          hovered: true,
          preferFull: true,
        },
      ];
      const bounds = { left: 0, top: 0, right: 500, bottom: 400 },
        reserved = [
          { left: 194, top: 118, right: 206, bottom: 130 },
          { left: 194, top: 218, right: 206, bottom: 230 },
        ];
      const result = layoutLabelsDetailed(input, bounds, reserved, {}, () => 0);
      expect(result.status).toBe('complete');
      expect(result.placements.every((entry) => entry.visible)).toBe(true);
      expect(
        result.placements.find((entry) => entry.id === 'selected'),
      ).not.toMatchObject({ dx: 0, dy: 0 });
      assertPacking(input, result.placements, bounds, reserved);
    },
  );
  it('packs all 28 mandatory targets with paired physical reservations and UI masks inside the unchanged 128-input cap', () => {
    const input: LabelRect[] = Array.from({ length: 28 }, (_, index) => ({
      ...label(
        'target-' + index,
        50 + (index % 4) * 300,
        90 + Math.floor(index / 4) * 130,
        index === 0,
      ),
      width: 200,
      height: 48,
      mandatory: true,
      locationCode: 'ITC-T' + index,
      compact: { width: 44, height: 44 },
    }));
    const reserved = input.map((entry) => ({
      left: entry.left + 94,
      top: entry.top + 18,
      right: entry.left + 106,
      bottom: entry.top + 30,
    }));
    reserved.push(
      { left: 0, top: 0, right: 1280, bottom: 44 },
      { left: 1210, top: 44, right: 1280, bottom: 1100 },
    );
    const bounds = { left: 0, top: 0, right: 1280, bottom: 1100 };
    expect(input.length + reserved.length).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxInputs,
    );
    const result = layoutLabelsDetailed(input, bounds, reserved, {}, () => 0);
    expect(result.status).toBe('complete');
    expect(result.placements.every((entry) => entry.visible)).toBe(true);
    expect(result.placements[0].compact ?? false).toBe(false);
    expect(result.stats.operations).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxOperations,
    );
    assertPacking(input, result.placements, bounds, reserved);
    const oversized = Array.from(
      { length: LABEL_PACKING_BUDGET.maxInputs - input.length + 1 },
      (_, index) => ({ left: index, top: 0, right: index + 1, bottom: 1 }),
    );
    const rejected = layoutLabelsDetailed(
      input,
      bounds,
      oversized,
      {},
      () => 0,
    );
    expect(rejected.status).toBe('budget-exhausted');
    expect(rejected.placements).toEqual([]);
  });
  it('finds an off-rail 44px pocket adjacent to reserved edges', () => {
    const input = [
      { ...label('pocket', 300, 300), width: 44, height: 44, mandatory: true },
    ];
    const reserved = [
      { left: 0, top: 0, right: 20, bottom: 100 },
      { left: 70, top: 0, right: 160, bottom: 100 },
      { left: 0, top: 0, right: 160, bottom: 14 },
      { left: 0, top: 64, right: 160, bottom: 100 },
    ];
    const result = layoutLabelsDetailed(input, viewport, reserved);
    expect(result.status).toBe('complete');
    expect(result.stats.greedyComplete).toBe(false);
    expect(result.placements[0]).toMatchObject({
      visible: true,
      dx: 23 - 300,
      dy: 17 - 300,
    });
    assertPacking(input, result.placements, viewport, reserved);
  });
  it('never reuses a compact selected footprint even when a compact variant was supplied', () => {
    const input = [
      {
        ...label('selected', 2, 2, true),
        width: 91,
        height: 44,
        compact: { width: 44, height: 44 },
        focused: true,
        previous: { dx: 0, dy: 0, compact: true },
        mandatory: true,
      },
    ];
    const result = layoutLabelsDetailed(input, viewport);
    expect(result.status).toBe('complete');
    expect(result.placements[0]).toMatchObject({
      visible: true,
      compact: false,
    });
    assertPacking(input, result.placements, viewport);
  });
  function offRailBacktrackingCase() {
    return {
      bounds: { left: 0, top: 0, right: 144, bottom: 125 },
      reserved: [
        { left: 0, top: 0, right: 144, bottom: 14 },
        { left: 0, top: 111, right: 144, bottom: 125 },
      ],
      input: [
        {
          ...label('wide', 26, 17),
          width: 91,
          height: 44,
          mandatory: true,
          priority: 10,
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          ...label('marker-' + index, 50, 64),
          width: 180,
          height: 44,
          compact: { width: 44, height: 44 },
          mandatory: true,
        })),
        { ...label('optional', 2, 64), width: 44, height: 44 },
      ],
    };
  }
  it('backtracks and relocates an ordinary full label to recover a certified feasible off-rail packing', () => {
    const { bounds, reserved, input } = offRailBacktrackingCase();
    // A constructive certificate is independent of candidate search.
    const certificate = [
      { id: 'wide', visible: true, dx: -24, dy: 0 },
      ...[
        [96, 17],
        [2, 64],
        [49, 64],
        [96, 64],
      ].map(([left, top], index) => ({
        id: 'marker-' + index,
        visible: true,
        dx: left - 50,
        dy: top - 64,
        compact: true,
      })),
    ];
    assertPacking(input, certificate, bounds, reserved);
    const result = layoutLabelsDetailed(input, bounds, reserved);
    expect(result.status).toBe('complete');
    expect(result.stats.greedyComplete).toBe(false);
    expect(result.stats.backtracks).toBeGreaterThan(0);
    expect(result.placements.find((entry) => entry.id === 'wide')!.dx).not.toBe(
      0,
    );
    expect(result.placements.filter((entry) => entry.visible)).toHaveLength(5);
    expect(
      result.placements.find((entry) => entry.id === 'optional')!.visible,
    ).toBe(false);
    assertPacking(input, result.placements, bounds, reserved);
    expect(
      layoutLabelsDetailed([...input].reverse(), bounds, reserved).placements,
    ).toEqual(result.placements);
  });
  it('distinguishes exhausted budgets from candidate infeasibility without claiming physical impossibility', () => {
    const input = [
      { ...label('target', 300, 300), width: 44, height: 44, mandatory: true },
    ];
    const exhausted = layoutLabelsDetailed(input, viewport, [], {
      maxOperations: 0,
    });
    expect(exhausted.status).toBe('budget-exhausted');
    expect(exhausted.stats.operations).toBe(0);
    expect(exhausted.placements[0].visible).toBe(false);
    const infeasible = layoutLabelsDetailed(input, {
      left: 0,
      top: 0,
      right: 47,
      bottom: 47,
    });
    expect(infeasible.status).toBe('candidate-infeasible');
    expect(infeasible.stats.operations).toBeLessThan(
      LABEL_PACKING_BUDGET.maxOperations,
    );
    expect(infeasible.placements[0].visible).toBe(false);
  });
  it('bounds nodes and candidates across the entire recovery while retaining a valid partial greedy result', () => {
    const { bounds, reserved, input } = offRailBacktrackingCase();
    for (const limits of [{ maxNodes: 0 }, { maxCandidates: 1 }]) {
      const result = layoutLabelsDetailed(input, bounds, reserved, limits);
      expect(result.status).toBe('budget-exhausted');
      expect(result.stats.nodes).toBeLessThanOrEqual(
        limits.maxNodes ?? LABEL_PACKING_BUDGET.maxNodes,
      );
      expect(result.stats.candidates).toBeLessThanOrEqual(
        limits.maxCandidates ?? LABEL_PACKING_BUDGET.maxCandidates,
      );
      assertPacking(input, result.placements, bounds, reserved);
    }
  });
  it.each(['left', 'top'] as const)(
    'never publishes a nonfinite %s anchor when the deadline interrupts placement validation',
    (axis) => {
      for (const coordinate of [NaN, Infinity, -Infinity]) {
        const input = [
          {
            ...label('bad', 0, 0),
            [axis]: coordinate,
            width: 44,
            height: 44,
            mandatory: true,
            compact: { width: 44, height: 44 },
          },
          {
            ...label('good', 2, 2),
            width: 44,
            height: 44,
            mandatory: true,
            compact: { width: 44, height: 44 },
          },
        ];
        // Sweep watchdog interruption points, including immediately after a
        // rail assignment but before the final validation pass (old cutoff 41).
        for (const cutoff of [
          ...Array.from({ length: 100 }, (_, i) => i + 1),
          Infinity,
        ]) {
          let calls = 0;
          const result = layoutLabelsDetailed(
            input,
            { left: 0, top: 0, right: 100, bottom: 100 },
            [],
            {},
            () => (++calls > cutoff ? 16 : 0),
          );
          expect(
            result.placements.find((entry) => entry.id === 'bad')?.visible,
            `coordinate=${coordinate}, cutoff=${cutoff}, status=${result.status}`,
          ).toBe(false);
          for (const placement of result.placements.filter(
            (entry) => entry.visible,
          )) {
            expect(Number.isFinite(placement.dx)).toBe(true);
            expect(Number.isFinite(placement.dy)).toBe(true);
          }
        }
      }
    },
  );
  it('expires cooperatively on the injected clock and preserves an already validated focused action', () => {
    const input = [
      {
        ...label('focused', 2, 2),
        width: 91,
        height: 44,
        mandatory: true,
        focused: true,
        previous: { dx: 0, dy: 0, compact: false },
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        ...label('other-' + index, 50, 50),
        width: 44,
        height: 44,
        mandatory: true,
      })),
    ];
    let ticks = 0;
    const result = layoutLabelsDetailed(
      input,
      viewport,
      [],
      { maxMilliseconds: 0.5 },
      () => ticks++ * 0.01,
    );
    expect(result.status).toBe('budget-exhausted');
    expect(
      result.placements.find((entry) => entry.id === 'focused'),
    ).toMatchObject({ visible: true, dx: 0, dy: 0 });
    assertPacking(input, result.placements, viewport);
  });
  it('does not treat near but different candidate domains and footprints as interchangeable', () => {
    const bounds = { left: 0, top: 0, right: 200, bottom: 100 };
    const reserved = [
      { left: 0, top: 0, right: 20, bottom: 100 },
      { left: 70, top: 0, right: 120, bottom: 100 },
      { left: 171, top: 0, right: 200, bottom: 100 },
      { left: 0, top: 0, right: 200, bottom: 14 },
      { left: 0, top: 64, right: 200, bottom: 100 },
    ];
    const input = [
      {
        ...label('small', 123, 17),
        width: 44,
        height: 44,
        mandatory: true,
        priority: 10,
      },
      { ...label('wide', 300, 300), width: 45, height: 44, mandatory: true },
    ];
    const result = layoutLabelsDetailed(input, bounds, reserved);
    expect(result.status).toBe('complete');
    expect(result.stats.greedyComplete).toBe(false);
    expect(
      result.placements.find((entry) => entry.id === 'small'),
    ).toMatchObject({ visible: true, dx: -100, dy: 0 });
    expect(
      result.placements.find((entry) => entry.id === 'wide'),
    ).toMatchObject({ visible: true, dx: 123 - 300, dy: 17 - 300 });
    assertPacking(input, result.placements, bounds, reserved);
  });
  it('checks the clock after native sorting and refuses oversized inputs before candidate allocation', () => {
    const input = [
      { ...label('mandatory', 2, 2), width: 44, height: 44, mandatory: true },
    ];
    let reads = 0;
    const sorted = layoutLabelsDetailed(input, viewport, [], {}, () =>
      ++reads >= 3 ? 100 : 0,
    );
    expect(sorted.status).toBe('budget-exhausted');
    expect(sorted.stats.candidates).toBe(0);
    expect(sorted.placements.every((entry) => !entry.visible)).toBe(true);
    const oversized = layoutLabelsDetailed(
      Array.from(
        { length: LABEL_PACKING_BUDGET.maxInputs + 1 },
        (_, index) => ({ ...input[0], id: String(index) }),
      ),
      viewport,
    );
    expect(oversized.status).toBe('budget-exhausted');
    expect(oversized.placements).toEqual([]);
    expect(oversized.stats.candidates).toBe(0);
  });
  const narrowViewport = { left: 30, top: 404, right: 345, bottom: 812 };
  const morePanel = [{ left: 106, top: 397, right: 346, bottom: 617 }];
  it('recovers all 22 exposed real-scene targets from fragmented prior placements with More open', () => {
    // Captured production RoomScene, room JSON, CSS and Inter font at 375x812.
    const input: LabelRect[] = capturedMore;
    expect(input).toHaveLength(22);
    const detailed = layoutLabelsDetailed(input, narrowViewport, morePanel);
    const result = detailed.placements;
    expect(
      result.every((entry) => entry.visible),
      JSON.stringify(detailed.stats),
    ).toBe(true);
    const areas = result.map((entry) => {
      const source = input.find((item) => item.id === entry.id)!;
      const size = entry.compact ? source.compact! : source;
      return {
        left: source.left + entry.dx,
        top: source.top + entry.dy,
        right: source.left + entry.dx + size.width,
        bottom: source.top + entry.dy + size.height,
      };
    });
    for (const [index, area] of areas.entries()) {
      expect(area.left).toBeGreaterThanOrEqual(narrowViewport.left + 2);
      expect(area.top).toBeGreaterThanOrEqual(narrowViewport.top + 2);
      expect(area.right).toBeLessThanOrEqual(narrowViewport.right - 2);
      expect(area.bottom).toBeLessThanOrEqual(narrowViewport.bottom - 2);
      for (const other of [...morePanel, ...areas.slice(index + 1)])
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
    }
    expect(result).toEqual(
      layoutLabels([...input].reverse(), narrowViewport, morePanel),
    );
    const repeated = input.map((entry) => {
      const placement = result.find((item) => item.id === entry.id)!;
      return {
        ...entry,
        previous: {
          dx: placement.dx,
          dy: placement.dy,
          compact: !!placement.compact,
        },
      };
    });
    expect(layoutLabels(repeated, narrowViewport, morePanel)).toEqual(result);
  });
  it('realigns inactive selected text to recover all 22 targets and remains stable on the next frame', () => {
    const input: LabelRect[] = capturedSelected;
    expect(input).toHaveLength(22);
    const detailed = layoutLabelsDetailed(input, narrowViewport, morePanel);
    const result = detailed.placements;
    expect(
      result.every((entry) => entry.visible),
      JSON.stringify(detailed.stats),
    ).toBe(true);
    const selected = input.find((entry) => entry.selected)!;
    // Same minimum-displacement result as exhaustive candidate traversal.
    expect(result.find((entry) => entry.id === selected.id)).toMatchObject({
      dx: 24,
      dy: -11.967041015625,
    });
    expect(result.find((entry) => entry.id === selected.id)?.visible).toBe(
      true,
    );
    expect(
      result.find((entry) => entry.id === selected.id)?.compact ?? false,
    ).toBe(false);
    const repeated = input.map((entry) => {
      const placed = result.find((item) => item.id === entry.id)!;
      return {
        ...entry,
        previous: { dx: placed.dx, dy: placed.dy, compact: !!placed.compact },
      };
    });
    expect(layoutLabels(repeated, narrowViewport, morePanel)).toEqual(result);
    // Pointer entry must preserve the selected full label's settled hit rectangle.
    expect(
      layoutLabels(
        repeated.map((entry) => ({ ...entry, hovered: entry.selected })),
        narrowViewport,
        morePanel,
      ),
    ).toEqual(result);
  });
  it('fits the captured focused selection plus a separately hovered full label without moving either', () => {
    const input: LabelRect[] = capturedActive;
    const active = input.filter((entry) => entry.focused || entry.hovered);
    expect(active).toHaveLength(2);
    const detailed = layoutLabelsDetailed(input, narrowViewport, morePanel);
    const result = detailed.placements;
    expect(
      result.every((entry) => entry.visible),
      JSON.stringify(detailed.stats),
    ).toBe(true);
    for (const entry of active)
      expect(result.find((item) => item.id === entry.id)).toMatchObject({
        visible: true,
        dx: entry.previous!.dx,
        dy: entry.previous!.dy,
      });
  });
  it.each([
    ['fits', 0],
    ['fits', 0.5],
    ['fits', 1],
    ['overflows', 0],
    ['overflows', 0.5],
    ['overflows', 1],
  ] as const)(
    'repacks only the newly selected full footprint when its prior compact position %s and pointer fraction %s',
    (variant, fraction) => {
      const input: LabelRect[] = capturedTransition.map((entry) =>
        entry.selected && variant === 'overflows'
          ? {
              ...entry,
              previous: {
                ...entry.previous!,
                dx: 299 - entry.left,
                compact: true,
              },
            }
          : entry.hovered
            ? {
                ...entry,
                pointer: {
                  x:
                    entry.left +
                    entry.previous!.dx +
                    1 +
                    (entry.width - 2) * fraction,
                  y: entry.top + entry.previous!.dy + 22,
                  bounds: {
                    left: entry.left + entry.previous!.dx,
                    top: entry.top + entry.previous!.dy,
                    right: entry.left + entry.previous!.dx + entry.width,
                    bottom: entry.top + entry.previous!.dy + entry.height,
                  },
                },
              }
            : entry,
      );
      // Geometry and work-budget correctness must not depend on OS scheduling.
      // Separate injected-deadline tests exercise the runtime watchdog.
      const detailed = layoutLabelsDetailed(
        input,
        narrowViewport,
        morePanel,
        { maxOperations: 150_000 },
        () => 0,
      );
      expect(detailed.status, JSON.stringify(detailed.stats)).toBe('complete');
      const result = detailed.placements;
      expect(
        result.every((entry) => entry.visible),
        JSON.stringify(detailed.stats),
      ).toBe(true);
      assertPacking(input, result, narrowViewport, morePanel);
      const selected = input.find((entry) => entry.selected)!;
      const full = result.find((entry) => entry.id === selected.id)!;
      expect(full.compact ?? false).toBe(false);
      const hovered = input.find((entry) => entry.hovered)!;
      const marker = result.find((entry) => entry.id === hovered.id)!;
      expect(marker.yielded).toBe(true);
      const box = {
        left: hovered.left + marker.dx,
        top: hovered.top + marker.dy,
        right: hovered.left + marker.dx + 44,
        bottom: hovered.top + marker.dy + 44,
      };
      expect(box.left).toBeGreaterThanOrEqual(hovered.pointer!.bounds.left);
      expect(box.right).toBeLessThanOrEqual(hovered.pointer!.bounds.right);
      expect(box.top).toBeGreaterThanOrEqual(hovered.pointer!.bounds.top);
      expect(box.bottom).toBeLessThanOrEqual(hovered.pointer!.bounds.bottom);
      expect(hovered.pointer!.x).toBeGreaterThanOrEqual(box.left);
      expect(hovered.pointer!.x).toBeLessThan(box.right);
      const settled = input.map((entry) => {
        const placed = result.find((item) => item.id === entry.id)!;
        return {
          ...entry,
          holdCompact: !!placed.yielded,
          previous: { dx: placed.dx, dy: placed.dy, compact: !!placed.compact },
        };
      });
      const settledResult = layoutLabelsDetailed(
        settled,
        narrowViewport,
        morePanel,
        { maxOperations: 150_000 },
        () => 0,
      );
      expect(settledResult.status).toBe('complete');
      expect(settledResult.placements).toEqual(result);
      expect(settled.find((entry) => entry.id === selected.id)?.focused).toBe(
        true,
      );
    },
  );
  it('shares rail geometry and skips slots already rejected within a packing trial', () => {
    const result = layoutLabelsDetailed(
      capturedSelected,
      narrowViewport,
      morePanel,
      { maxOperations: 60_000, maxCandidates: 8_000 },
      () => 0,
    );
    expect(result.status, JSON.stringify(result.stats)).toBe('complete');
    expect(result.placements.every((entry) => entry.visible)).toBe(true);
    assertPacking(
      capturedSelected,
      result.placements,
      narrowViewport,
      morePanel,
    );
    expect(
      result.placements.find(
        (entry) =>
          entry.id === capturedSelected.find((label) => label.selected)!.id,
      ),
    ).toMatchObject({ dx: 24, dy: -11.967041015625 });
  });
  it('reuses each measured label offset tail across directional trials within the allocation budget', () => {
    const result = layoutLabelsDetailed(
      capturedSelected,
      narrowViewport,
      morePanel,
      { maxCandidates: 20_000 },
      () => 0,
    );
    expect(result.status, JSON.stringify(result.stats)).toBe('complete');
    expect(result.placements.every((entry) => entry.visible)).toBe(true);
    expect(
      result.placements.find(
        (entry) =>
          entry.id === capturedSelected.find((label) => label.selected)!.id,
      ),
    ).toMatchObject({
      dx: 24,
      dy: -11.967041015625,
    });
  });
  it('reserves mandatory actions before spending the search budget preserving optional full hover text', () => {
    const input: LabelRect[] = capturedTransition.map((entry) =>
      entry.hovered
        ? {
            ...entry,
            pointer: {
              x: entry.left + entry.previous!.dx + entry.width / 2,
              y: entry.top + entry.previous!.dy + entry.height / 2,
              bounds: {
                left: entry.left + entry.previous!.dx,
                top: entry.top + entry.previous!.dy,
                right: entry.left + entry.previous!.dx + entry.width,
                bottom: entry.top + entry.previous!.dy + entry.height,
              },
            },
          }
        : entry,
    );
    // An operation cap makes the priority regression deterministic across hosts.
    // Separate injected-deadline tests retain the cooperative watchdog contract.
    const result = layoutLabelsDetailed(
      input,
      narrowViewport,
      morePanel,
      { maxOperations: 150_000 },
      () => 0,
    );
    expect(result.status, JSON.stringify(result.stats)).toBe('complete');
    expect(result.placements.every((entry) => entry.visible)).toBe(true);
    const hovered = input.find((entry) => entry.hovered)!;
    expect(
      result.placements.find((entry) => entry.id === hovered.id),
    ).toMatchObject({
      visible: true,
      compact: true,
      yielded: true,
    });
    const selected = input.find((entry) => entry.selected)!;
    expect(
      result.placements.find((entry) => entry.id === selected.id)?.compact ??
        false,
    ).toBe(false);
  });
  it('keeps a prior full hovered action pinned without a valid pointer witness even if coverage is incomplete', () => {
    const input: LabelRect[] = capturedTransition;
    const hovered = input.find((entry) => entry.hovered)!;
    for (const pointer of [
      undefined,
      { x: NaN, y: 0, bounds: morePanel[0] },
      { x: 0, y: 0, bounds: morePanel[0] },
    ]) {
      const result = layoutLabels(
        input.map((entry) =>
          entry === hovered ? { ...entry, pointer } : entry,
        ),
        narrowViewport,
        morePanel,
      );
      expect(result.find((entry) => entry.id === hovered.id)).toMatchObject({
        visible: true,
        compact: false,
        dx: hovered.previous!.dx,
        dy: hovered.previous!.dy,
      });
      expect(result.some((entry) => !entry.visible)).toBe(true);
    }
  });
  it.each(['focused', 'hovered'] as const)(
    'honestly reports impossible capacity beside a %s selected action',
    (active) => {
      // Usable area is 92x44: the 91x44 selected action leaves only one pixel.
      const input: LabelRect[] = [
        {
          ...label('selected', 2, 2, true),
          mandatory: true,
          width: 91,
          height: 44,
          [active]: true,
          previous: { dx: 0, dy: 0, compact: false },
        },
        { ...label('other', 2, 2), mandatory: true, width: 44, height: 44 },
      ];
      const result = layoutLabels(input, {
        left: 0,
        top: 0,
        right: 96,
        bottom: 48,
      });
      expect(result.find((entry) => entry.id === 'selected')).toMatchObject({
        visible: true,
        dx: 0,
        dy: 0,
      });
      expect(result.find((entry) => entry.id === 'other')?.visible).toBe(false);
    },
  );
  it('uses the lower free band when an overlay cuts across the top-origin rail grid', () => {
    const input = Array.from({ length: 24 }, (_, index) => ({
      ...label(String(index), 150, 650),
      mandatory: true,
      width: 180,
      height: 44,
      compact: { width: 44, height: 44 },
    }));
    expect(
      layoutLabels(input, narrowViewport, morePanel).every(
        (entry) => entry.visible,
      ),
    ).toBe(true);
  });
  it('preserves a genuinely focused expanded footprint and selected text during fallback', () => {
    const input: LabelRect[] = [
      {
        ...label('focused', 32, 625),
        mandatory: true,
        focused: true,
        preferFull: true,
        width: 91,
        height: 44,
        compact: { width: 44, height: 44 },
        previous: { dx: 0, dy: 0, compact: false },
      },
      {
        ...label('selected', 126, 625, true),
        mandatory: true,
        width: 185,
        height: 44,
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        ...label('M' + index, 150, 700),
        mandatory: true,
        width: 180,
        height: 44,
        compact: { width: 44, height: 44 },
      })),
    ];
    const detailed = layoutLabelsDetailed(input, narrowViewport, morePanel);
    const result = detailed.placements;
    expect(
      result.every((entry) => entry.visible),
      JSON.stringify(detailed.stats),
    ).toBe(true);
    expect(result.find((entry) => entry.id === 'focused')).toMatchObject({
      visible: true,
      dx: 0,
      dy: 0,
      compact: false,
    });
    expect(result.find((entry) => entry.id === 'selected')).toMatchObject({
      visible: true,
      dx: 0,
      dy: 0,
    });
  });
  it('expands focus text only when every occupied action stays in its original placement', () => {
    const input: LabelRect[] = [
      {
        ...label('focus', 10, 10),
        priority: 3,
        mandatory: true,
        width: 130,
        height: 44,
        compact: { width: 44, height: 44 },
      },
      {
        ...label('neighbor', 70, 10),
        priority: 3,
        mandatory: true,
        width: 130,
        height: 44,
        compact: { width: 44, height: 44 },
      },
    ];
    const normal = layoutLabels(input, viewport);
    const focused = layoutLabels(
      input.map((entry) => ({ ...entry, preferFull: entry.id === 'focus' })),
      viewport,
    );
    expect(focused).toEqual(normal);
    expect(focused.every((entry) => entry.visible && entry.compact)).toBe(true);
    const spacious = layoutLabels(
      [{ ...input[0], preferFull: true }],
      viewport,
    );
    expect(spacious[0]).toMatchObject({
      visible: true,
      compact: false,
      dx: 0,
      dy: 0,
    });
  });
  it('fits 28 occupied 44px actions plus a wrapped selected label on a narrow 310px canvas', () => {
    const input: LabelRect[] = [
      {
        ...label('selected', 30, 160, true),
        locationCode: 'SELECTED',
        priority: 4,
        mandatory: true,
        width: 240,
        height: 84,
      },
      ...Array.from({ length: 27 }, (_, index) => ({
        ...label(`occupied-${index}`, 140, 195),
        locationCode: `L${String(index).padStart(2, '0')}`,
        priority: 3,
        mandatory: true,
        width: 220,
        height: 62,
        compact: { width: 44, height: 44 },
      })),
    ];
    const result = layoutLabels(input, {
      left: 0,
      top: 0,
      right: 310,
      bottom: 410,
    });
    expect(result.every((item) => item.visible)).toBe(true);
    const areas = result.map((item) => {
      const source = input.find((row) => row.id === item.id)!;
      const size = item.compact ? source.compact! : source;
      return {
        left: source.left + item.dx,
        top: source.top + item.dy,
        right: source.left + item.dx + size.width,
        bottom: source.top + item.dy + size.height,
      };
    });
    for (const [index, area] of areas.entries())
      for (const other of areas.slice(index + 1))
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
  });
  it('reports insufficient capacity instead of shrinking mandatory actions or pretending they fit an overlay', () => {
    const input = Array.from({ length: 28 }, (_, index) => ({
      ...label(`L${index}`, 150, 150),
      locationCode: `L${index}`,
      priority: 3,
      mandatory: true,
      width: 44,
      height: 44,
    }));
    const result = layoutLabels(
      input,
      { left: 0, top: 0, right: 310, bottom: 410 },
      [{ left: 10, top: 0, right: 310, bottom: 300 }],
    );
    expect(result.filter((item) => item.visible).length).toBeLessThan(28);
    expect(result.some((item) => !item.visible)).toBe(true);
  });
  it('uses preferred positions and separates colliding drawer rows deterministically', () => {
    const input = [label('D04', 50, 37), label('D01', 50, 30)];
    const first = layoutLabels(input, viewport);
    expect(first).toEqual(layoutLabels([...input].reverse(), viewport));
    expect(first.find((item) => item.id === 'D01')).toMatchObject({
      visible: true,
      dx: 0,
      dy: 0,
    });
    const second = first.find((item) => item.id === 'D04')!;
    expect(second.visible).toBe(true);
    const verticalGap = Math.abs(37 + second.dy - 30);
    const horizontalGap = Math.abs(second.dx);
    expect(verticalGap >= 21 || horizontalGap >= 48).toBe(true);
  });

  it('keeps selected labels first and inside canvas edges', () => {
    const input = [label('ordinary', 0, 0), label('selected', 0, 0, true)];
    const placements = layoutLabels(input, viewport);
    const selected = placements.find((item) => item.id === 'selected')!;
    const ordinary = placements.find((item) => item.id === 'ordinary')!;
    expect(selected).toMatchObject({ visible: true, dx: 8, dy: 8 });
    expect(ordinary.visible).toBe(true);
    for (const item of placements) {
      expect(item.dx).toBeGreaterThanOrEqual(-56);
      expect(item.dx).toBeLessThanOrEqual(56);
      expect(item.dy).toBeGreaterThanOrEqual(-56);
      expect(item.dy).toBeLessThanOrEqual(56);
      expect(
        input.find((row) => row.id === item.id)!.left + item.dx,
      ).toBeGreaterThanOrEqual(2);
      expect(
        input.find((row) => row.id === item.id)!.top + item.dy,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('suppresses lowest-priority labels when bounded space cannot hold them', () => {
    const crowded = [label('selected', 10, 10, true), label('low', 10, 10)];
    const placements = layoutLabels(crowded, {
      left: 0,
      top: 0,
      right: 55,
      bottom: 25,
    });
    expect(placements.find((item) => item.id === 'selected')?.visible).toBe(
      true,
    );
    expect(placements.find((item) => item.id === 'low')?.visible).toBe(false);
  });

  it('prioritizes selection then hover, deduplicates location text and avoids reserved panels', () => {
    const input = [
      { ...label('decoration', 30, 30), priority: 0 },
      { ...label('normal', 30, 30), priority: 1, locationCode: 'ITC-D01' },
      { ...label('hover', 30, 30), priority: 2, locationCode: 'ITC-D01' },
      { ...label('selected', 30, 30), priority: 3, locationCode: 'ITC-D02' },
    ];
    const reserved = [{ left: 0, top: 0, right: 70, bottom: 25 }];
    const placements = layoutLabels(input, viewport, reserved);
    expect(placements.map((item) => item.id)).toEqual([
      'selected',
      'hover',
      'normal',
      'decoration',
    ]);
    expect(placements.find((item) => item.id === 'normal')?.visible).toBe(
      false,
    );
    const areas = placements
      .filter((item) => item.visible)
      .map((item) => {
        const source = input.find((row) => row.id === item.id)!;
        return {
          left: source.left + item.dx,
          top: source.top + item.dy,
          right: source.left + item.dx + source.width,
          bottom: source.top + item.dy + source.height,
        };
      });
    for (const [index, area] of areas.entries())
      for (const other of [...reserved, ...areas.slice(index + 1)])
        expect(
          area.left >= other.right + 3 ||
            area.right + 3 <= other.left ||
            area.top >= other.bottom + 3 ||
            area.bottom + 3 <= other.top,
        ).toBe(true);
  });
});
