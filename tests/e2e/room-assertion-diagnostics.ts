import type { Locator, Page } from '@playwright/test';
import room from '../../data/rooms/it-closet.json';

const identities = new Set<string>([
  'hover-tooltip',
  room.roomId,
  room.locationCode,
]);
function visit(nodes: typeof room.nodes) {
  for (const node of nodes) {
    identities.add(node.id);
    if ('locationCode' in node) identities.add(node.locationCode);
    if ('children' in node) visit(node.children as typeof room.nodes);
  }
}
visit(room.nodes);
const fields = new Set([
  'schema',
  'transaction',
  'complete',
  'settled',
  'passes',
  'labels',
  'viewport',
  'reserved',
  'output',
  'error',
  'id',
  'locationCode',
  'selected',
  'priority',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'mandatory',
  'preferFull',
  'focused',
  'hovered',
  'pointer',
  'x',
  'y',
  'bounds',
  'holdCompact',
  'compact',
  'previous',
  'dx',
  'dy',
  'visible',
  'yielded',
  'revision',
  'entries',
  'code',
  'status',
  'reason',
  'work',
  'triangles',
  'overlaps',
  'fragments',
  'operations',
  'revisionReused',
  'rays',
  'elapsedMilliseconds',
]);
const tokens = new Set([
  'visible',
  'hidden',
  'pending',
  'unresolved',
  'invalid-data',
  'entry-bound',
  'pass-bound',
  'byte-bound',
  'idle',
  'flying',
  'revealing',
  'settled',
  'cancelled',
  'unrecognized-reason',
  'viewport not measured',
  'scene revision pending',
  'projection context belongs to another scene or camera',
  'frame time allowance exhausted',
  'work budget exhausted',
  'orthographic camera required',
  'deformed or instanced geometry requires a projection adapter',
  'continuation frame limit reached',
  'non-finite projected geometry',
  'empty viewport',
  'surface witness rejected by authoritative ray',
  'surface proof pending',
  'fingerprint unsupported within structural limits: work budget exhausted',
]);
for (const token of [...tokens]) tokens.add('fingerprint incomplete: ' + token);

/** Re-project already bounded runtime snapshots; never transport text or errors. */
export function sanitizedRoomSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string')
    return identities.has(value) || tokens.has(value) ? value : null;
  if (Array.isArray(value))
    return value.length <= 96
      ? value.map((entry) => sanitizedRoomSnapshot(entry, depth + 1))
      : null;
  if (typeof value !== 'object' || !value) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => fields.has(key))
      .map(([key, entry]) => [key, sanitizedRoomSnapshot(entry, depth + 1)]),
  );
}

export async function captureRoomAssertionState(
  page: Page,
  code: string,
  includeLayout = true,
) {
  if (!identities.has(code)) return { available: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const capture = page.evaluate(
      ({ code, includeLayout }) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-room-surface] canvas',
        );
        const finite = (value: number) =>
          Number.isFinite(value) ? value : null;
        const rect = (value: DOMRect) => ({
          left: finite(value.left),
          top: finite(value.top),
          right: finite(value.right),
          bottom: finite(value.bottom),
        });
        const flag = (value?: string) =>
          value === 'true' ? true : value === 'false' ? false : null;
        const elements = document.querySelectorAll<HTMLElement>(
          `[data-room-label-code="${code}"]`,
        );
        const label = elements[0];
        const full = label?.querySelector('[data-room-label-full]');
        const ranges = (node: Node | undefined | null, textOnly = false) => {
          if (!node) return [];
          const targets = textOnly
            ? [...node.childNodes].filter(
                (child) => child.nodeType === Node.TEXT_NODE,
              )
            : [node];
          return targets
            .flatMap((target) => {
              const range = document.createRange();
              range.selectNodeContents(target);
              return [...range.getClientRects()].slice(0, 32).map(rect);
            })
            .slice(0, 32);
        };
        let ancestorHidden = false;
        for (
          let parent = label?.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden')
            ancestorHidden = true;
        }
        let request: unknown = null;
        try {
          request = JSON.parse(
            (canvas?.dataset.spatialRequest ?? '').slice(0, 1024),
          );
        } catch {
          /* no request */
        }
        return {
          available: !!canvas,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          phase: canvas?.dataset.spatialPhase,
          openCode: canvas?.dataset.spatialOpenCode,
          request,
          fitDispatch: window.__roomFitDispatchDiagnostic ?? null,
          label: {
            count: elements.length,
            suppressed: flag(label?.dataset.labelSuppressed),
            compact: flag(label?.dataset.labelCompact),
            exposed: flag(label?.dataset.roomExposed),
            ariaHidden: flag(label?.getAttribute('aria-hidden') ?? undefined),
            ancestorHidden,
            ownHidden: label
              ? getComputedStyle(label).visibility === 'hidden'
              : null,
            bounds: label ? rect(label.getBoundingClientRect()) : null,
            firstChildRects: ranges(label?.firstChild),
            nameTextRects: ranges(full, true),
            badgeRects: full
              ? [...full.children]
                  .slice(0, 8)
                  .map((child) => rect(child.getBoundingClientRect()))
              : [],
          },
          layout: includeLayout
            ? (window.__roomLabelLayoutSnapshot ?? null)
            : null,
          visibility: includeLayout
            ? (window.__roomVisibilitySnapshot ?? null)
            : null,
        };
      },
      { code, includeLayout },
    );
    const reading = await Promise.race([
      capture,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('capture deadline')), 1000);
      }),
    ]);
    const lifecycle = (value: unknown) => {
      const source = value as Record<string, unknown> | null;
      const request = source?.request as Record<string, unknown> | null;
      return {
        phase: sanitizedRoomSnapshot(source?.phase),
        openCode:
          source?.openCode === ''
            ? ''
            : sanitizedRoomSnapshot(source?.openCode),
        request: request
          ? {
              code: sanitizedRoomSnapshot(request.code),
              scope: sanitizedRoomSnapshot(request.scope),
              generation: Number.isSafeInteger(request.generation)
                ? request.generation
                : null,
              requestId: Number.isSafeInteger(request.requestId)
                ? request.requestId
                : null,
            }
          : null,
      };
    };
    return {
      available: reading.available,
      viewport: reading.viewport,
      ...lifecycle(reading),
      fitDispatch: reading.fitDispatch
        ? {
            ...lifecycle(reading.fitDispatch),
            trusted: reading.fitDispatch.trusted === true,
          }
        : null,
      label: reading.label,
      layout: sanitizedRoomSnapshot(reading.layout),
      visibility: sanitizedRoomSnapshot(reading.visibility),
    };
  } catch {
    return { available: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

declare global {
  interface Window {
    __roomFitDispatchDiagnostic?: {
      phase?: string;
      openCode?: string;
      request: unknown;
      trusted: boolean;
    } | null;
  }
}

/** Capture the trusted click in capture phase, before the toolbar's handler. */
export async function observeRoomFitDispatch(button: Locator) {
  await button.evaluate((element) => {
    window.__roomFitDispatchDiagnostic = null;
    element.addEventListener(
      'click',
      (event) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-room-surface] canvas',
        );
        let request: unknown = null;
        try {
          request = JSON.parse(
            (canvas?.dataset.spatialRequest ?? '').slice(0, 1024),
          );
        } catch {
          /* no request */
        }
        window.__roomFitDispatchDiagnostic = {
          phase: canvas?.dataset.spatialPhase,
          openCode: canvas?.dataset.spatialOpenCode,
          request,
          trusted: event.isTrusted,
        };
      },
      { capture: true, once: true },
    );
  });
}

export function reportRoomAssertionFailure(
  stage:
    | 'selected-rack-label'
    | 'fit-interruption'
    | 'rack-labels-off'
    | 'drawer-name-lines',
  code: string,
  observations: {
    state?: Awaited<ReturnType<typeof captureRoomAssertionState>>;
    afterClick?: Awaited<ReturnType<typeof captureRoomAssertionState>>;
    afterHold?: Awaited<ReturnType<typeof captureRoomAssertionState>>;
    failure?: Awaited<ReturnType<typeof captureRoomAssertionState>>;
    viewport?: { width: number; height: number };
    side?: number;
    firstChildRectCount?: number;
  },
) {
  // Callers supply only captureRoomAssertionState results and numeric side data.
  const encoded = JSON.stringify({
    stage,
    code: identities.has(code) ? code : null,
    ...observations,
  });
  console.info(
    'ROOM_ASSERTION_DIAGNOSTIC ' +
      (Buffer.byteLength(encoded) <= 128 * 1024
        ? encoded
        : JSON.stringify({ stage, complete: false, sizeBound: true })),
  );
}
