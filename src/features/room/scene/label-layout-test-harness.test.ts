import { expect, it } from 'vitest';
import {
  layoutLabelsDetailed,
  type LabelRect,
} from './label-layout-test-harness';

const labels: LabelRect[] = [
  {
    id: 'one',
    left: 10,
    top: 10,
    width: 44,
    height: 44,
    selected: false,
    mandatory: true,
  },
];
const viewport = { left: 0, top: 0, right: 160, bottom: 100 };

it('keeps operation exhaustion authoritative with the static geometry clock', () => {
  const result = layoutLabelsDetailed(labels, viewport, [], {
    maxOperations: 0,
  });
  expect(result.status).toBe('budget-exhausted');
  expect(result.stats.exhaustion?.reason).toBe('operations');
  expect(result.placements.every((entry) => !entry.visible)).toBe(true);
});

it('preserves an explicit advancing clock and its cooperative deadline', () => {
  let now = 0;
  const result = layoutLabelsDetailed(
    labels,
    viewport,
    [],
    { maxMilliseconds: 0.5 },
    () => now++,
  );
  expect(now).toBeGreaterThan(1);
  expect(result.status).toBe('budget-exhausted');
  expect(result.stats.exhaustion?.reason).toBe('time');
  expect(result.placements.every((entry) => !entry.visible)).toBe(true);
});
