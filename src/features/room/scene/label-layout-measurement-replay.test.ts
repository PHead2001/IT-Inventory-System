import { expect, it } from 'vitest';
import captured from '../../../../tests/fixtures/room/actual-f214-scroll-more-measurement.json';
import {
  LABEL_PACKING_BUDGET,
  layoutLabelsDetailed,
  type LabelRect,
} from './label-layout';

it('replays the complete 27-action packing result from the native post-solver measurement timeout', () => {
  expect(captured.provenance.transactionComplete).toBe(false);
  expect(captured.provenance.runtimeFailure).toBe('measurement-budget');
  const input = captured.input;
  const original = structuredClone(input);
  expect(input.labels).toHaveLength(27);
  expect(input.labels.every((label) => label.mandatory)).toBe(true);
  const outcome = layoutLabelsDetailed(
    input.labels as LabelRect[],
    input.viewport,
    input.reserved,
    {},
    () => 0,
  );
  expect(outcome.status).toBe('complete');
  expect(outcome.stats.exhaustion).toBeUndefined();
  expect(outcome.placements).toEqual(captured.recordedOutput);
  expect(outcome.placements.filter((row) => row.visible)).toHaveLength(27);
  expect(outcome.stats.operations).toBeLessThanOrEqual(
    LABEL_PACKING_BUDGET.maxOperations,
  );
  expect(outcome.stats.candidates).toBeLessThanOrEqual(
    LABEL_PACKING_BUDGET.maxCandidates,
  );
  expect(outcome.stats.nodes).toBeLessThanOrEqual(
    LABEL_PACKING_BUDGET.maxNodes,
  );
  const areas = [...input.reserved];
  for (const row of outcome.placements) {
    const label = input.labels.find((label) => label.id === row.id)!;
    const size = row.compact ? label.compact! : label;
    const area = {
      left: label.left + row.dx,
      top: label.top + row.dy,
      right: label.left + row.dx + size.width,
      bottom: label.top + row.dy + size.height,
    };
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
  }
  expect(input).toEqual(original);
});
