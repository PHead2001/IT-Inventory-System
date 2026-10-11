import type { Page } from '@playwright/test';
import {
  captureRoomWitness,
  roomRayWitnessAt,
} from './room-visibility-witness';

export type RoomPointerAttempt = {
  expectedCode: string;
  point: { x: number; y: number };
  candidates: { x: number; y: number }[];
};
declare global {
  interface Window {
    readonly __roomDiagnosticPointerEvent?: {
      type: string;
      clientX: number;
      clientY: number;
      canvas: boolean;
    } | null;
  }
}

const MAX_BYTES = 128 * 1024;
export type RoomLayoutWitnessStage =
  | 'scroll-more-overlapping-canvas'
  | 'scroll-more-outside-canvas-without-reopening'
  | 'fit-closed'
  | 'fit-open'
  | 'oblique-open'
  | 'overhead-open'
  | 'underside-open'
  | 'fit-open-selected-before-long-text'
  | 'fit-open-selected-long-text';
export async function enableRoomLayoutDiagnostics(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__roomLayoutDiagnosticsEnabled', {
      value: true,
    });
    let last: Window['__roomDiagnosticPointerEvent'] = null;
    Object.defineProperty(window, '__roomDiagnosticPointerEvent', {
      get: () => last,
    });
    for (const type of ['pointerenter', 'pointermove', 'pointerdown'])
      document.addEventListener(
        type,
        (event) => {
          const pointer = event as PointerEvent;
          if (
            !pointer.isTrusted ||
            !Number.isFinite(pointer.clientX) ||
            !Number.isFinite(pointer.clientY)
          )
            return;
          last = {
            type,
            clientX: pointer.clientX,
            clientY: pointer.clientY,
            canvas:
              pointer.target ===
              document.querySelector('[data-room-surface] canvas'),
          };
        },
        true,
      );
  });
}

/** Emit only fixture geometry and an allowlisted projection of existing telemetry. */
export async function reportRoomLayoutFailure(
  page: Page,
  allowedCodes: string[],
  stage: RoomLayoutWitnessStage,
  outcome: 'failure' | 'measurement' = 'failure',
  pointer?: RoomPointerAttempt,
) {
  try {
    if (
      pointer &&
      (!allowedCodes.includes(pointer.expectedCode) ||
        pointer.candidates.length > 10000 ||
        [...pointer.candidates, pointer.point].some(
          (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
        ))
    )
      throw new Error('pointer-bound');
    const report = await page.evaluate(
      ({ codes, stage, outcome, pointer }) => {
        const allowed = new Set(codes);
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-testid="room-viewer"] canvas',
        );
        const numeric = (value: string | undefined) => {
          if (value === undefined) return null;
          const result = Number(value);
          if (!Number.isFinite(result)) throw new Error('invalid-telemetry');
          return result;
        };
        const flag = (value: string | undefined) => {
          if (value === undefined) return null;
          if (value !== 'true' && value !== 'false')
            throw new Error('invalid-telemetry');
          return value === 'true';
        };
        const matrix = (value: string | undefined) => {
          if (value === undefined) return null;
          const numbers: unknown = JSON.parse(value);
          if (
            !Array.isArray(numbers) ||
            numbers.length !== 16 ||
            !numbers.every(
              (entry) => typeof entry === 'number' && Number.isFinite(entry),
            )
          )
            throw new Error('invalid-camera');
          return numbers as number[];
        };
        const elements = [
          ...document.querySelectorAll<HTMLElement>('[data-room-label-code]'),
        ];
        if (elements.length > 96) throw new Error('telemetry-bound');
        const labels = elements.map((element) => {
          const code = element.dataset.roomLabelCode;
          if (!code || !allowed.has(code)) throw new Error('unknown-code');
          return {
            code,
            exposed: flag(element.dataset.roomExposed),
            suppressed: flag(element.dataset.labelSuppressed),
            compact: flag(element.dataset.labelCompact),
            dx: numeric(element.dataset.labelDx),
            dy: numeric(element.dataset.labelDy),
          };
        });
        const rectangle = (element: Element | null | undefined) => {
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
          };
        };
        const topAt = (point: { x: number; y: number }) => {
          const top = document.elementFromPoint(point.x, point.y);
          const label = top?.closest<HTMLElement>('[data-room-label-code]');
          const code = label?.dataset.roomLabelCode;
          return {
            canvas: top === canvas,
            kind:
              top === canvas
                ? 'canvas'
                : label
                  ? 'room-label'
                  : top?.closest('[data-hover-tooltip]')
                    ? 'hover-tooltip'
                    : top?.closest('[data-room-obstruction]')
                      ? 'room-obstruction'
                      : top
                        ? 'other'
                        : 'absent',
            code: code && allowed.has(code) ? code : null,
            bounds: rectangle(top),
          };
        };
        const actualEvent = window.__roomDiagnosticPointerEvent ?? null;
        return {
          stage,
          outcome,
          measured: {
            canvas: rectangle(canvas),
            more: rectangle(
              document.querySelector('[data-room-obstruction="true"]'),
            ),
            selected: rectangle(
              elements.find(
                (element) => element.getAttribute('aria-pressed') === 'true',
              ),
            ),
          },
          snapshot: window.__roomLabelLayoutSnapshot ?? null,
          visibility: window.__roomVisibilitySnapshot ?? null,
          camera: {
            azimuth: numeric(canvas?.dataset.cameraAzimuth),
            elevation: numeric(canvas?.dataset.cameraElevation),
            zoom: numeric(canvas?.dataset.cameraZoom),
            view: matrix(canvas?.dataset.cameraViewMatrix),
            projection: matrix(canvas?.dataset.cameraProjectionMatrix),
          },
          pointer: pointer
            ? {
                expectedCode: pointer.expectedCode,
                requested: pointer.point,
                requestedCoverage: topAt(pointer.point),
                candidates: pointer.candidates
                  .slice(0, 16)
                  .map((point) => ({ ...point, coverage: topAt(point) })),
                candidateCount: pointer.candidates.length,
                actualEvent,
                actualCoverage: actualEvent
                  ? topAt({ x: actualEvent.clientX, y: actualEvent.clientY })
                  : null,
              }
            : null,
          telemetry: {
            revision: numeric(canvas?.dataset.labelLayoutRevision),
            pending: flag(canvas?.dataset.labelLayoutPending),
            layoutErrorPresent: !!canvas?.dataset.labelLayoutError,
            labels,
          },
        };
      },
      { codes: allowedCodes, stage, outcome, pointer: pointer ?? null },
    );
    let independent: object | null = null;
    if (pointer) {
      try {
        const scene = await captureRoomWitness(page);
        const rayAt = (point: { x: number; y: number }) => {
          const ray = roomRayWitnessAt(scene, point);
          return {
            ...ray,
            code:
              ray.code === null || allowedCodes.includes(ray.code)
                ? ray.code
                : 'unknown-code',
          };
        };
        independent = {
          frame: scene.frame,
          view: scene.view,
          projection: scene.projection,
          requested: rayAt(pointer.point),
          actual: report.pointer?.actualEvent
            ? rayAt({
                x: report.pointer.actualEvent.clientX,
                y: report.pointer.actualEvent.clientY,
              })
            : null,
        };
      } catch {
        independent = { captureError: true };
      }
    }
    const encoded = JSON.stringify({ ...report, independent });
    if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES)
      throw new Error('payload-bound');
    console.log('ROOM_LABEL_LAYOUT_DIAGNOSTIC ' + encoded);
  } catch {
    console.log(
      'ROOM_LABEL_LAYOUT_DIAGNOSTIC ' +
        JSON.stringify({
          stage,
          outcome,
          captureError: true,
          complete: false,
        }),
    );
  }
}
