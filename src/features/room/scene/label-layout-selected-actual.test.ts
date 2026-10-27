import { describe, expect, it } from 'vitest';
import actual from '../../../../tests/fixtures/room/actual-6cd-selected-incomplete-pass.json';
import initial from '../../../../tests/fixtures/room/actual-80d-more-initial.json';
import {
  LABEL_PACKING_BUDGET,
  layoutLabelsDetailed,
  type LabelRect,
  type LabelPlacement,
} from './label-layout';

const input = actual.input;
const solve = (labels: LabelRect[], limits = {}) =>
  layoutLabelsDetailed(labels, input.viewport, input.reserved, limits, () => 0);
function assertComplete(labels: LabelRect[], placements: LabelPlacement[]) {
  expect(placements.filter((row) => row.visible)).toHaveLength(28);
  expect(new Set(placements.map((row) => row.id)).size).toBe(labels.length);
  assertGeometry(labels, placements);
}
function assertGeometry(labels: LabelRect[], placements: LabelPlacement[]) {
  const areas = [...input.reserved];
  for (const row of placements.filter((row) => row.visible)) {
    const label = labels.find((label) => label.id === row.id)!;
    const size = row.compact ? label.compact! : label;
    const area = {
      left: label.left + row.dx,
      top: label.top + row.dy,
      right: label.left + row.dx + size.width,
      bottom: label.top + row.dy + size.height,
    };
    expect(Object.values(area).every(Number.isFinite)).toBe(true);
    expect(area.left).toBeGreaterThanOrEqual(input.viewport.left + 2);
    expect(area.top).toBeGreaterThanOrEqual(input.viewport.top + 2);
    expect(area.right).toBeLessThanOrEqual(input.viewport.right - 2);
    expect(area.bottom).toBeLessThanOrEqual(input.viewport.bottom - 2);
    for (const other of areas)
      expect(
        area.left >= other.right + 3 ||
          area.right + 3 <= other.left ||
          area.top >= other.bottom + 3 ||
          area.bottom + 3 <= other.top,
      ).toBe(true);
    areas.push(area);
    if (label.selected) expect(row.compact).not.toBe(true);
  }
}
const remember = (labels: LabelRect[], placements: LabelPlacement[]) =>
  labels.map((label) => {
    const placed = placements.find((row) => row.id === label.id)!;
    return {
      ...label,
      previous: {
        dx: placed.dx,
        dy: placed.dy,
        compact: placed.compact === true,
      },
    };
  });

describe('actual selected pass in incomplete6cd transaction', () => {
  it('completes all28 mandatory identities before selected trials, retaining the verified full selected rectangle', () => {
    expect(actual.provenance.transactionComplete).toBe(false);
    expect(actual.provenance.settled).toBe(false);
    expect(actual.provenance.worldTriangleGeometryCaptured).toBe(false);
    expect(input.labels.filter((row) => row.mandatory)).toHaveLength(28);
    const original = structuredClone(input);
    const result = solve(input.labels);
    expect(result.status).toBe('complete');
    expect(result.stats.exhaustion).toBeUndefined();
    expect(result.stats.operations).toBeLessThan(200_000);
    expect(result.stats.nodes).toBeGreaterThan(0);
    expect(result.stats.nodes).toBeLessThan(LABEL_PACKING_BUDGET.maxNodes);
    expect(result.placements.find((row) => row.id === 'shelf-1a')).toEqual(
      actual.recordedOutput.find((row) => row.id === 'shelf-1a'),
    );
    assertComplete(input.labels, result.placements);
    expect(input).toEqual(original);
    expect(solve([...input.labels].reverse())).toEqual(result);
  });

  it('preserves initial placement and settles selected/repeated frames', () => {
    const first = initial.snapshot.passes.at(-1)!;
    const initialResult = layoutLabelsDetailed(
      first.labels,
      first.viewport,
      first.reserved,
      {},
      () => 0,
    );
    expect(initialResult.status).toBe('complete');
    expect(initialResult.placements).toEqual(first.output);
    const selected = solve(input.labels);
    expect(selected.status).toBe('complete');
    const labels = remember(input.labels, selected.placements);
    const repeated = solve(labels);
    expect(repeated.status).toBe('complete');
    expect(repeated.placements).toEqual(selected.placements);
    assertComplete(labels, repeated.placements);
  });

  it('never claims complete coverage for an independently impossible synthetic118px full footprint', () => {
    const selected = solve(input.labels);
    // Supplemental synthetic remeasurement, not a captured hosted long-text pass.
    const labels = remember(input.labels, selected.placements).map((label) =>
      label.selected ? { ...label, height: label.height + 20 } : label,
    );
    // Supplemental geometry, not a CI/native long-text measurement. These three
    // captured anchors overlap every legal horizontal position of a 238px label.
    // Their open forbidden vertical intervals cover every legal 118px position.
    const full = labels.find((label) => label.selected)!;
    const minLeft = input.viewport.left + 2;
    const maxLeft = input.viewport.right - 2 - full.width;
    const maxTop = input.viewport.bottom - 2 - full.height;
    let requiredTop = input.viewport.top + 2;
    for (const code of ['ITC-RACK', 'ITC-S3C', 'ITC-CLEAR']) {
      const index = input.labels.findIndex(
        (label) => label.locationCode === code,
      );
      const anchor = input.reserved[index + 1];
      expect(maxLeft).toBeLessThan(anchor.right + 3);
      expect(minLeft + full.width + 3).toBeGreaterThan(anchor.left);
      expect(requiredTop).toBeGreaterThan(anchor.top - 3 - full.height);
      expect(requiredTop).toBeLessThan(anchor.bottom + 3);
      requiredTop = anchor.bottom + 3;
    }
    expect(requiredTop).toBeGreaterThan(maxTop);
    const longer = solve(labels);
    expect(longer.status).toBe('budget-exhausted');
    expect(longer.stats.exhaustion).toBeDefined();
    expect(
      longer.placements.find((row) => row.id === 'shelf-1a')?.compact,
    ).not.toBe(true);
    expect(longer.placements.filter((row) => row.visible).length).toBeLessThan(
      28,
    );
    assertGeometry(labels, longer.placements);
    expect(solve(labels)).toEqual(longer);
  });

  it('keeps live selected full focus and a compact focused/hovered pointer action pinned', () => {
    const base = solve(input.labels);
    const labels = remember(input.labels, base.placements);
    const compact = labels.find((label) => label.id === 'drawer-1')!;
    const point = {
      x: compact.left + compact.previous.dx + 22,
      y: compact.top + compact.previous.dy + 22,
      bounds: {
        left: compact.left + compact.previous.dx,
        top: compact.top + compact.previous.dy,
        right: compact.left + compact.previous.dx + 44,
        bottom: compact.top + compact.previous.dy + 44,
      },
    };
    for (const inspection of ['focused', 'hovered'] as const) {
      const live = input.labels.map((label) =>
        label.selected
          ? {
              ...label,
              focused: true,
              previous: labels.find((row) => row.id === label.id)!.previous,
            }
          : label.id === compact.id
            ? {
                ...label,
                [inspection]: true,
                pointer: point,
                previous: compact.previous,
              }
            : label,
      );
      const result = solve(live);
      expect(result.status).toBe('complete');
      expect(result.stats.nodes).toBeGreaterThan(0);
      for (const id of ['shelf-1a', compact.id])
        expect(result.placements.find((row) => row.id === id)).toEqual(
          base.placements.find((row) => row.id === id),
        );
      assertComplete(live, result.placements);
    }
  });

  it('never replaces the verified preferred result with a partial shared solution when its node budget expires', () => {
    const result = solve(input.labels, { maxNodes: 0 });
    expect(result.status).toBe('budget-exhausted');
    expect(result.stats.exhaustion).toEqual({
      reason: 'nodes',
      phase: 'preferred',
    });
    expect(result.stats.nodes).toBe(0);
    assertGeometry(input.labels, result.placements);
    const complete = solve(input.labels);
    // Stop after some slot assignments, immediately before the last one. The
    // whole candidate must be discarded; never splice its partial placements.
    const partial = solve(input.labels, { maxNodes: complete.stats.nodes - 1 });
    expect(partial.status).toBe('budget-exhausted');
    expect(partial.placements).toEqual(result.placements);
    expect(result.placements.find((row) => row.id === 'shelf-1a')).toEqual(
      actual.recordedOutput.find((row) => row.id === 'shelf-1a'),
    );
  });
});
