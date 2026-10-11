import type { Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  captureRoomWitness,
  roomRayWitnessAt,
  type WitnessSnapshot,
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
/** Failure-only transport. Whole-scene geometry preserves every possible opaque
 * occluder; never silently emit a partial scene that could prove false exposure. */
export function roomGeometryReplay(
  scene: WitnessSnapshot,
  allowedCodes: string[],
  stage: RoomLayoutWitnessStage,
  byteBudget: number,
) {
  const incomplete = () => [
    JSON.stringify({ schema: 1, stage, complete: false, truncated: true }),
  ];
  try {
    const finite = (values: number[], length: number) => {
      if (values.length !== length || !values.every(Number.isFinite))
        throw new Error('invalid');
      return [...values];
    };
    if (
      scene.triangles.length > 25000 ||
      scene.masks.length > 96 ||
      (scene.meshes?.length ?? 0) > 5000
    )
      return incomplete();
    const allowed = new Set(allowedCodes);
    const rectangles = (r: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }) => {
      const [left, top, right, bottom] = finite(
        [r.left, r.top, r.right, r.bottom],
        4,
      );
      return { left, top, right, bottom };
    };
    const [x, y, width, height] = finite(
      [scene.frame.x, scene.frame.y, scene.frame.width, scene.frame.height],
      4,
    );
    const payload = {
      schema: 1,
      stage,
      complete: true,
      scene: {
        view: finite(scene.view, 16),
        projection: finite(scene.projection, 16),
        frame: { x, y, width, height },
        masks: scene.masks.map(rectangles),
        meshes: (scene.meshes ?? []).map((mesh, index) => {
          if (
            mesh.index !== index ||
            mesh.topology !== 'triangles' ||
            !['box', 'buffer'].includes(mesh.geometry)
          )
            throw new Error('invalid');
          return { index, topology: 'triangles', geometry: mesh.geometry };
        }),
        triangles: scene.triangles.map((triangle) => {
          if (
            (triangle.code !== null && !allowed.has(triangle.code)) ||
            ![0, 1, 2].includes(triangle.side) ||
            !Number.isSafeInteger(triangle.sourceMesh) ||
            triangle.sourceMesh! < 0 ||
            triangle.sourceMesh! >= (scene.meshes?.length ?? 0)
          )
            throw new Error('invalid');
          return {
            code: triangle.code,
            side: triangle.side,
            vertices: finite(triangle.vertices, 9),
            sourceMesh: triangle.sourceMesh,
          };
        }),
      },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    if (raw.length > 8 * 1024 * 1024) return incomplete();
    const encoded = gzipSync(raw).toString('base64');
    if (encoded.length > 96 * 1024) return incomplete();
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const parts = Math.ceil(encoded.length / (12 * 1024));
    const records = Array.from({ length: parts }, (_, part) =>
      JSON.stringify({
        schema: 1,
        stage,
        complete: true,
        encoding: 'gzip-base64',
        sha256,
        part,
        parts,
        data: encoded.slice(part * 12 * 1024, (part + 1) * 12 * 1024),
      }),
    );
    return records.reduce(
      (bytes, record) => bytes + Buffer.byteLength(record) + 32,
      0,
    ) <= byteBudget
      ? records
      : incomplete();
  } catch {
    return incomplete();
  }
}
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
          enabled: window.__roomLayoutDiagnosticsEnabled === true,
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
    if (!report.enabled) return;
    let independent: object | null = null;
    let replayScene: WitnessSnapshot | null = null;
    if (pointer) {
      try {
        const scene = await captureRoomWitness(page);
        if (outcome === 'failure') replayScene = scene;
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
    if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES - 512)
      throw new Error('payload-bound');
    console.log('ROOM_LABEL_LAYOUT_DIAGNOSTIC ' + encoded);
    if (outcome === 'failure' && pointer) {
      const records = replayScene
        ? roomGeometryReplay(
            replayScene,
            allowedCodes,
            stage,
            MAX_BYTES - Buffer.byteLength(encoded) - 512,
          )
        : [
            JSON.stringify({
              schema: 1,
              stage,
              complete: false,
              captureError: true,
            }),
          ];
      for (const record of records)
        console.log('ROOM_GEOMETRY_REPLAY ' + record);
    }
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
