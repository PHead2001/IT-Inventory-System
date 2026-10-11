import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { reportRoomLayoutFailure } from '../e2e/room-layout-diagnostics';
import { uncoveredRoomWitnesses } from '../e2e/room-visibility-witness';

const page = {
  evaluate: async (
    callback: (argument: unknown) => unknown,
    argument: unknown,
  ) => callback(argument),
} as unknown as Page;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(
  document,
  'elementFromPoint',
);
afterEach(() => {
  document.body.replaceChildren();
  for (const key of [
    '__roomVisibilitySnapshot',
    '__roomDiagnosticPointerEvent',
  ])
    Reflect.deleteProperty(window, key);
  if (originalElementFromPoint)
    Object.defineProperty(
      document,
      'elementFromPoint',
      originalElementFromPoint,
    );
  else Reflect.deleteProperty(document, 'elementFromPoint');
  vi.restoreAllMocks();
});
function surface() {
  const root = document.createElement('div');
  root.dataset.roomSurface = 'true';
  root.dataset.testid = 'room-viewer';
  const canvas = document.createElement('canvas');
  root.append(canvas);
  document.body.append(root);
  const cover = document.createElement('button');
  cover.dataset.roomLabelCode = 'ITC-S3A';
  cover.textContent = 'private fixture text must never be logged';
  root.append(cover);
  return { canvas, cover };
}
it('rechecks live DOM coverage and retains the same independent expected target', async () => {
  const { canvas, cover } = surface();
  let firstCovered = false;
  let allCovered = false;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn((x: number) =>
      allCovered || (firstCovered && x === 10) ? cover : canvas,
    ),
  });
  const samples = new Map([
    [
      'ITC-S3A',
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
    ],
  ]);
  expect(await uncoveredRoomWitnesses(page, samples)).toEqual(
    new Map([['ITC-S3A', { x: 10, y: 20 }]]),
  );
  firstCovered = true;
  expect(await uncoveredRoomWitnesses(page, samples)).toEqual(
    new Map([['ITC-S3A', { x: 30, y: 40 }]]),
  );
  allCovered = true;
  expect((await uncoveredRoomWitnesses(page, samples)).size).toBe(0);
});
it('keeps expected and actual pointer evidence when independent scene capture is unavailable', async () => {
  const { canvas, cover } = surface();
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn((x: number) => (x === 10 ? canvas : cover)),
  });
  canvas.dataset.cameraElevation = '1.570696326796269';
  canvas.dataset.labelLayoutRevision = '347';
  Reflect.set(window, '__roomDiagnosticPointerEvent', {
    type: 'pointermove',
    clientX: 30,
    clientY: 40,
    canvas: false,
  });
  Reflect.set(window, '__roomVisibilitySnapshot', {
    schema: 1,
    revision: 11,
    complete: true,
    entries: [
      {
        code: 'ITC-S3A',
        status: 'pending',
        reason: 'surface proof pending',
        work: {
          triangles: 12,
          overlaps: 0,
          fragments: 0,
          operations: 12,
          revisionReused: false,
          rays: 0,
          elapsedMilliseconds: 1,
        },
      },
    ],
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await reportRoomLayoutFailure(page, ['ITC-S3A'], 'overhead-open', 'failure', {
    expectedCode: 'ITC-S3A',
    point: { x: 10, y: 20 },
    candidates: Array.from({ length: 20 }, () => ({ x: 10, y: 20 })),
  });
  const encoded = log.mock.calls[0][0] as string;
  const report = JSON.parse(
    encoded.slice('ROOM_LABEL_LAYOUT_DIAGNOSTIC '.length),
  );
  expect(report.pointer.expectedCode).toBe('ITC-S3A');
  expect(report.pointer.requestedCoverage.canvas).toBe(true);
  expect(report.pointer.actualEvent).toMatchObject({
    clientX: 30,
    clientY: 40,
  });
  expect(report.pointer.actualCoverage).toMatchObject({
    kind: 'room-label',
    code: 'ITC-S3A',
  });
  expect(report.pointer.candidates).toHaveLength(16);
  expect(report.pointer.candidateCount).toBe(20);
  expect(report.visibility.entries[0]).toMatchObject({
    status: 'pending',
    reason: 'surface proof pending',
    work: { operations: 12 },
  });
  expect(report.camera.elevation).toBe(1.570696326796269);
  expect(report.telemetry.revision).toBe(347);
  expect(report.independent).toEqual({ captureError: true });
  expect(encoded).not.toContain(cover.textContent);
  expect(Buffer.byteLength(encoded)).toBeLessThan(128 * 1024);
});
