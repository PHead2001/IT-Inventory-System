import { expect, it } from 'vitest';
import captured from '../../../../tests/fixtures/room/actual-f214-red-full-deadline.json';
import {
  LABEL_PACKING_BUDGET,
  layoutLabelsDetailed,
  type LabelArea,
  type LabelPlacement,
  type LabelRect,
} from './label-layout';
import { createLabelLayoutDiagnostics } from './label-layout-diagnostics';

function assertRepresentations(
  labels: LabelRect[],
  placements: LabelPlacement[],
  viewport: LabelArea,
  reserved: LabelArea[],
) {
  const byId = new Map(labels.map((label) => [label.id, label]));
  const visible = placements.filter((row) => row.visible);
  const required = new Set(
    labels
      .filter((label) => label.mandatory || label.selected)
      .map((label) => label.locationCode ?? label.id),
  );
  expect(
    new Set(
      visible
        .map((row) => byId.get(row.id)!)
        .map((label) => label.locationCode ?? label.id)
        .filter((code) => required.has(code)),
    ),
  ).toEqual(required);
  const occupied = [...reserved];
  for (const row of visible) {
    const label = byId.get(row.id)!;
    if (label.selected) expect(row.compact).not.toBe(true);
    const size = row.compact ? label.compact! : label;
    const area = {
      left: label.left + row.dx,
      top: label.top + row.dy,
      right: label.left + row.dx + size.width,
      bottom: label.top + row.dy + size.height,
    };
    expect(Object.values(area).every(Number.isFinite)).toBe(true);
    expect(area.left).toBeGreaterThanOrEqual(viewport.left + 2);
    expect(area.top).toBeGreaterThanOrEqual(viewport.top + 2);
    expect(area.right).toBeLessThanOrEqual(viewport.right - 2);
    expect(area.bottom).toBeLessThanOrEqual(viewport.bottom - 2);
    for (const other of occupied)
      expect(
        area.left >= other.right + 3 ||
          area.right + 3 <= other.left ||
          area.top >= other.bottom + 3 ||
          area.bottom + 3 <= other.top,
      ).toBe(true);
    occupied.push(area);
  }
}
it('fits every captured occupied representation with explicit passive 24px badges while keeping selected RED full and all physical reservations unchanged', () => {
  const original = structuredClone(captured.input);
  expect(original.labels).toHaveLength(29);
  expect(original.reserved).toHaveLength(29);
  expect(captured.provenance.recordedSolver.stats.exhaustion).toMatchObject({
    reason: 'time',
    phase: 'preferred',
  });
  // Historical 44px action input remains unchanged. This is a presentation-only
  // model, not a claim that a native 24px DOM capture has already been obtained.
  const labels: LabelRect[] = original.labels.map((label) =>
    label.mandatory && !label.selected
      ? {
          ...label,
          presentation: 'occupied-marker' as const,
          width: 24,
          height: 24,
          compact: { width: 24, height: 24 },
          preferFull: false,
          focused: false,
          hovered: false,
        }
      : label,
  );
  const red = labels.find((label) => label.selected)!;
  expect(red).toMatchObject({ width: 202.390625, height: 44, selected: true });
  expect(red.presentation).toBeUndefined();
  for (const step of [0, 0.002]) {
    let ticks = 0;
    const result = layoutLabelsDetailed(
      labels,
      original.viewport,
      original.reserved,
      {},
      () => ++ticks * step,
    );
    expect(result.status, JSON.stringify(result.stats)).toBe('complete');
    expect(result.stats.exhaustion).toBeUndefined();
    expect(result.stats.operations).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxOperations,
    );
    expect(result.stats.candidates).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxCandidates,
    );
    expect(result.stats.nodes).toBeLessThanOrEqual(
      LABEL_PACKING_BUDGET.maxNodes,
    );
    expect(result.stats.elapsedMs).toBeLessThan(
      LABEL_PACKING_BUDGET.maxMilliseconds,
    );
    assertRepresentations(
      labels,
      result.placements,
      original.viewport,
      original.reserved,
    );
  }
  expect(captured.input).toEqual(original);
});
it('deduplicates a passive marker only against its own eligible full label, keeping every other occupied code represented', () => {
  const badge = (id: string): LabelRect => ({
    id,
    locationCode: id,
    selected: false,
    mandatory: true,
    presentation: 'occupied-marker',
    priority: 3,
    left: 40,
    top: 50,
    width: 24,
    height: 24,
    compact: { width: 24, height: 24 },
  });
  const labels: LabelRect[] = [
    badge('A'),
    badge('B'),
    {
      id: 'full-A',
      locationCode: 'A',
      selected: false,
      focused: true,
      previous: { dx: 0, dy: 0, compact: false },
      priority: 3.5,
      left: 40,
      top: 50,
      width: 110,
      height: 44,
    },
  ];
  const viewport = { left: 0, top: 0, right: 300, bottom: 200 };
  const result = layoutLabelsDetailed(labels, viewport, [], {}, () => 0);
  expect(result.status).toBe('complete');
  expect(result.placements.find((row) => row.id === 'full-A')!.visible).toBe(
    true,
  );
  expect(result.placements.find((row) => row.id === 'A')!.visible).toBe(false);
  expect(result.placements.find((row) => row.id === 'B')!.visible).toBe(true);
  assertRepresentations(labels, result.placements, viewport, []);
});
it('retains only the fixed passive presentation enum in gated diagnostics and refuses a selected passive representation', () => {
  const target = { __roomLayoutDiagnosticsEnabled: true } as Window;
  const capture = createLabelLayoutDiagnostics(target)!;
  const badge: LabelRect = {
    id: 'drawer-1',
    locationCode: 'ITC-D01',
    selected: false,
    presentation: 'occupied-marker',
    left: 20,
    top: 20,
    width: 24,
    height: 24,
    compact: { width: 24, height: 24 },
    mandatory: true,
  };
  const viewport = { left: 0, top: 0, right: 300, bottom: 200 };
  capture.begin(0);
  capture.input([badge], viewport, []);
  expect(
    target.__roomLabelLayoutSnapshot!.passes[0].labels[0].presentation,
  ).toBe('occupied-marker');
  capture.begin(1);
  capture.input([{ ...badge, selected: true }], viewport, []);
  expect(target.__roomLabelLayoutSnapshot!.error).toBe('invalid-data');
});
