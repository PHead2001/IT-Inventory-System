import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import captured from '../../../../tests/fixtures/room/ci-phone-selected-capacity.json';
import {
  layoutLabels,
  layoutLabelsDetailed,
  LABEL_PACKING_BUDGET,
  type LabelArea,
  type LabelPlacement,
  type LabelRect,
} from './label-layout-test-harness';

// Sanitized CI 38023742642 / job 114130066900, exact settled transaction 221
// at cf3caf4551b3aa44dab4e33b3f614c8574049e0b; geometry/flags/output retained.
const baseline = captured.passes[0];
const labels: LabelRect[] = baseline.labels;
const css = readFileSync(
  resolve(process.cwd(), 'src/features/room/room-visual.module.css'),
  'utf8',
);

// This models the authored border-box limits against the exact failing inputs.
// It is not a revised browser measurement: the unchanged phone E2E must record
// the actual popup, wrapped selected text and all independently exposed targets.
function modeledPhonePanel(): LabelArea[] {
  const phone = css.match(
    /@media \(max-width: 720px\) \{\s*\.moreMenu \{([^}]+)\}/,
  );
  expect(
    phone,
    'canonical phone breakpoint overrides the popup footprint',
  ).toBeTruthy();
  const width = Number(phone![1].match(/--room-menu-width: (\d+)px/)?.[1]);
  const height = Number(phone![1].match(/--room-menu-height: (\d+)px/)?.[1]);
  expect(Number.isFinite(width) && width > 0).toBe(true);
  expect(Number.isFinite(height) && height > 0).toBe(true);
  return baseline.reserved.map((panel) => ({
    ...panel,
    left: panel.right - width,
    bottom: panel.top + height,
  }));
}

function assertPhysicalPlacement(
  result: LabelPlacement[],
  reserved: LabelArea[],
  input: LabelRect[] = labels,
  complete = true,
) {
  expect(result).toHaveLength(input.length);
  if (complete) expect(result.every((entry) => entry.visible)).toBe(true);
  const areas = result
    .filter((entry) => entry.visible)
    .map((placed) => {
      const source = input.find((entry) => entry.id === placed.id)!;
      const size = placed.compact ? source.compact! : source;
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
      if (source.selected) {
        expect(placed.compact ?? false).toBe(false);
        expect(size).toMatchObject({
          width: source.width,
          height: source.height,
        });
      }
      return {
        left: source.left + placed.dx,
        top: source.top + placed.dy,
        right: source.left + placed.dx + size.width,
        bottom: source.top + placed.dy + size.height,
      };
    });
  for (const [index, area] of areas.entries()) {
    expect(area.left).toBeGreaterThanOrEqual(baseline.viewport.left + 2);
    expect(area.top).toBeGreaterThanOrEqual(baseline.viewport.top + 2);
    expect(area.right).toBeLessThanOrEqual(baseline.viewport.right - 2);
    expect(area.bottom).toBeLessThanOrEqual(baseline.viewport.bottom - 2);
    for (const other of [...reserved, ...areas.slice(index + 1)]) {
      expect(
        area.left >= other.right + 3 ||
          area.right + 3 <= other.left ||
          area.top >= other.bottom + 3 ||
          area.bottom + 3 <= other.top,
      ).toBe(true);
    }
  }
}

describe('captured CI phone selected-label capacity', () => {
  it('retains the historical deficient output as evidence, with bounded honest search on its original geometry', () => {
    expect(captured).toMatchObject({
      schema: 1,
      transaction: 221,
      complete: true,
      settled: true,
    });
    expect(labels).toHaveLength(22);
    expect(
      labels.every(
        (entry) => entry.mandatory && !entry.focused && !entry.hovered,
      ),
    ).toBe(true);
    expect(baseline.output.filter((entry) => entry.visible)).toHaveLength(19);
    expect(
      baseline.output
        .filter((entry) => !entry.visible)
        .map((entry) => entry.id),
    ).toEqual(['shelf-3c', 'shelf-4b', 'shelf-4c']);
    const startedAt = performance.now();
    const result = layoutLabelsDetailed(
      labels,
      baseline.viewport,
      baseline.reserved,
    );
    const elapsedMs = performance.now() - startedAt;
    expect(result.status === 'complete').toBe(
      result.placements.every((entry) => entry.visible),
    );
    assertPhysicalPlacement(
      result.placements,
      baseline.reserved,
      labels,
      false,
    );
    expect(result.stats.operations).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxOperations,
    );
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('packs a constructive 27-action supplementary long-text stress case once More is outside the canvas', () => {
    // Modeled from the retained transaction-306 shape/counts, not a claimed
    // full-precision browser fixture. All 26 compact actions remain mandatory.
    const selected = labels.find((entry) => entry.selected)!;
    const input: LabelRect[] = [
      { ...selected, left: -25, top: 565, height: 116, previous: undefined },
      ...Array.from({ length: 26 }, (_, index) => ({
        id: `occupied-${index}`,
        locationCode: `O-${index}`,
        left: 80 + index * 7,
        top: 575 + index * 3,
        width: 144,
        height: 44,
        compact: { width: 44, height: 44 },
        mandatory: true,
        selected: false,
      })),
    ];
    const left = baseline.viewport.left + 2,
      top = baseline.viewport.top + 2;
    const certificate: LabelPlacement[] = [
      {
        id: selected.id,
        visible: true,
        dx: left - input[0].left,
        dy: top - input[0].top,
      },
      ...input.slice(1).map((entry, index) => {
        const x = index < 2 ? left + 241 : left + ((index - 2) % 6) * 47;
        const y =
          index < 2
            ? top + index * 47
            : top + 119 + Math.floor((index - 2) / 6) * 47;
        return {
          id: entry.id,
          visible: true,
          dx: x - entry.left,
          dy: y - entry.top,
          compact: true,
        };
      }),
    ];
    assertPhysicalPlacement(certificate, [], input);
    const startedAt = performance.now();
    const result = layoutLabelsDetailed(input, baseline.viewport);
    const elapsedMs = performance.now() - startedAt;
    expect(result.status).toBe('complete');
    assertPhysicalPlacement(result.placements, [], input);
    expect(
      layoutLabelsDetailed([...input].reverse(), baseline.viewport).placements,
    ).toEqual(result.placements);
    expect(elapsedMs).toBeLessThan(2000);

    const obstructedStartedAt = performance.now();
    const obstructed = layoutLabelsDetailed(
      input,
      baseline.viewport,
      modeledPhonePanel(),
    );
    const obstructedElapsedMs = performance.now() - obstructedStartedAt;
    expect(obstructed.status).not.toBe('complete');
    assertPhysicalPlacement(
      obstructed.placements,
      modeledPhonePanel(),
      input,
      false,
    );
    expect(obstructed.stats.operations).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxOperations,
    );
    expect(obstructed.stats.nodes).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxNodes,
    );
    expect(obstructedElapsedMs).toBeLessThan(2000);
    // Independent upper bound: inflate targets by the required 3px gap.
    // A 94px strip for 194px + one-marker remainder beside 241x119 selected
    // text + six-marker width over remaining 94px cannot hold 26x47px.
    expect(2 * 194 + 119 + 6 * 94).toBeLessThan(26 * 47);
  });

  it('models all 22 actions beside the CSS phone popup without shrinking selected text or touch targets', () => {
    const reserved = modeledPhonePanel();
    const result = layoutLabels(labels, baseline.viewport, reserved);
    assertPhysicalPlacement(result, reserved);
    expect(
      layoutLabels([...labels].reverse(), baseline.viewport, reserved),
    ).toEqual(result);
    const settled = labels.map((entry) => {
      const placed = result.find((item) => item.id === entry.id)!;
      return {
        ...entry,
        previous: { dx: placed.dx, dy: placed.dy, compact: !!placed.compact },
      };
    });
    expect(layoutLabels(settled, baseline.viewport, reserved)).toEqual(result);
  });
});
