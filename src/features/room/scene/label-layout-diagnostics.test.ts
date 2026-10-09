import { expect, it } from 'vitest';
import { layoutLabels, type LabelRect } from './label-layout';
import {
  createLabelLayoutDiagnostics,
  LABEL_DIAGNOSTIC_MAX_BYTES,
  LABEL_DIAGNOSTIC_MAX_ENTRIES,
} from './label-layout-diagnostics';

const viewport = { left: 0, top: 0, right: 375, bottom: 500 };
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
