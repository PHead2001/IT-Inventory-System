import { afterEach, expect, it, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import {
  captureRoomAssertionState,
  observeRoomFitDispatch,
  reportRoomAssertionFailure,
  sanitizedRoomSnapshot,
} from '../e2e/room-assertion-diagnostics';

const page = {
  evaluate: async (
    callback: (argument: unknown) => unknown,
    argument: unknown,
  ) => callback(argument),
} as unknown as Page;

afterEach(() => {
  document.body.replaceChildren();
  for (const key of [
    '__roomFitDispatchDiagnostic',
    '__roomLabelLayoutSnapshot',
    '__roomVisibilitySnapshot',
  ])
    Reflect.deleteProperty(window, key);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function scene() {
  const root = document.createElement('div');
  root.dataset.roomSurface = 'true';
  const canvas = document.createElement('canvas');
  Object.assign(canvas.dataset, {
    spatialPhase: 'flying',
    spatialOpenCode: '',
    spatialRequest: JSON.stringify({
      scope: 'it-closet',
      code: 'ITC-D01',
      generation: 2,
      requestId: 3,
      private: 'secret',
    }),
  });
  root.append(canvas);
  document.body.append(root);
  return { root, canvas };
}

it('keeps numeric layout/visibility evidence while removing private and unknown fields', () => {
  const result = sanitizedRoomSnapshot({
    complete: true,
    entries: [
      {
        code: 'ITC-RACK',
        status: 'unresolved',
        reason: 'secret',
        work: { rays: 11, operations: 99 },
      },
    ],
    passes: [
      {
        labels: [
          {
            id: 'server-rack',
            selected: true,
            width: 180,
            left: 3,
            readableSummary: 'private item',
          },
        ],
        output: [{ id: 'server-rack', visible: false, dx: 0, dy: 0 }],
      },
    ],
    error: 'private URL',
    message: 'private inventory',
  });
  expect(result).toEqual({
    complete: true,
    entries: [
      {
        code: 'ITC-RACK',
        status: 'unresolved',
        reason: null,
        work: { rays: 11, operations: 99 },
      },
    ],
    passes: [
      {
        labels: [{ id: 'server-rack', selected: true, width: 180, left: 3 }],
        output: [{ id: 'server-rack', visible: false, dx: 0, dy: 0 }],
      },
    ],
    error: null,
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|private|URL|inventory/);
  expect(
    sanitizedRoomSnapshot({
      labels: Array.from({ length: 97 }, () => ({})),
      width: Infinity,
    }),
  ).toEqual({ labels: null, width: null });
});

it('separates name text geometry from badge geometry without reading either text value', async () => {
  const { root } = scene();
  const parent = document.createElement('div');
  parent.style.visibility = 'hidden';
  const label = document.createElement('button');
  label.dataset.roomLabelCode = 'ITC-RACK';
  label.dataset.labelSuppressed = 'true';
  const full = document.createElement('span');
  full.dataset.roomLabelFull = 'true';
  full.append(document.createTextNode('private location name'));
  const badge = document.createElement('span');
  badge.textContent = 'private stock quantities';
  full.append(badge);
  label.append(full);
  parent.append(label);
  root.append(parent);
  const selected: Node[] = [];
  const geometry = { left: 1, top: 2, right: 8, bottom: 9 };
  vi.spyOn(document, 'createRange').mockImplementation(
    () =>
      ({
        selectNodeContents: (node: Node) => selected.push(node),
        getClientRects: () => [geometry],
      }) as unknown as Range,
  );
  vi.spyOn(badge, 'getBoundingClientRect').mockReturnValue(geometry as DOMRect);
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const reading = await captureRoomAssertionState(page, 'ITC-RACK');
  expect(reading).toMatchObject({
    label: {
      count: 1,
      suppressed: true,
      ancestorHidden: true,
      firstChildRects: [geometry],
      nameTextRects: [geometry],
      badgeRects: [geometry],
    },
  });
  expect(selected).toEqual([full, full.firstChild]);
  expect(JSON.stringify(reading)).not.toMatch(/private|secret/);
  expect(log).not.toHaveBeenCalled();
});

it('records the click dispatch phase before the toolbar handler and retains subsequent phases separately', async () => {
  const { root, canvas } = scene();
  const button = document.createElement('button');
  root.append(button);
  await observeRoomFitDispatch({
    evaluate: async (callback: (element: HTMLElement) => void) =>
      callback(button),
  } as unknown as Locator);
  button.addEventListener('click', () => {
    canvas.dataset.spatialPhase = 'cancelled';
  });
  button.click();
  const reading = await captureRoomAssertionState(page, 'ITC-D01', false);
  expect(reading).toMatchObject({
    phase: 'cancelled',
    openCode: '',
    fitDispatch: {
      phase: 'flying',
      openCode: '',
      trusted: false,
      request: {
        scope: 'it-closet',
        code: 'ITC-D01',
        generation: 2,
        requestId: 3,
      },
    },
    layout: null,
    visibility: null,
  });
  expect(JSON.stringify(reading)).not.toMatch(/private|secret/);
  canvas.dataset.spatialPhase = 'settled';
  button.click();
  expect(await captureRoomAssertionState(page, 'ITC-D01', false)).toMatchObject(
    { fitDispatch: { phase: 'flying' } },
  );
});

it('handles unavailable capture and malformed request without exposing raw errors or replacing assertions', async () => {
  const { canvas } = scene();
  canvas.dataset.spatialRequest = 'private URL and token';
  canvas.dataset.spatialPhase = 'private state';
  canvas.dataset.spatialOpenCode = 'private code';
  const reading = await captureRoomAssertionState(page, 'ITC-D01', false);
  expect(reading).toMatchObject({ phase: null, openCode: null, request: null });
  expect(
    await captureRoomAssertionState(
      {
        evaluate: async () => {
          throw new Error('secret');
        },
      } as unknown as Page,
      'ITC-D01',
    ),
  ).toEqual({ available: false });
  expect(await captureRoomAssertionState(page, 'private selector')).toEqual({
    available: false,
  });
});

it('emits immediate bounded failure evidence without waiting for the final reporter', async () => {
  scene();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const state = await captureRoomAssertionState(page, 'ITC-D01', false);
  reportRoomAssertionFailure('drawer-name-lines', 'ITC-D01', {
    state,
    viewport: { width: 390, height: 844 },
    side: 2,
    firstChildRectCount: 3,
  });
  const encoded = log.mock.calls[0][0] as string;
  expect(encoded).toMatch(/^ROOM_ASSERTION_DIAGNOSTIC /);
  expect(
    JSON.parse(encoded.slice('ROOM_ASSERTION_DIAGNOSTIC '.length)),
  ).toMatchObject({
    side: 2,
    firstChildRectCount: 3,
    state: { phase: 'flying' },
  });
  expect(encoded).not.toMatch(/private|secret/);
  reportRoomAssertionFailure('selected-rack-label', 'ITC-RACK', {
    state: { ...state, layout: Array.from({ length: 128 * 1024 }, () => 0) },
  });
  expect(
    JSON.parse(
      (log.mock.calls[1][0] as string).slice(
        'ROOM_ASSERTION_DIAGNOSTIC '.length,
      ),
    ),
  ).toEqual({ stage: 'selected-rack-label', complete: false, sizeBound: true });
});

it('bounds a stalled browser capture and preserves allowlisted visibility budget reasons', async () => {
  vi.useFakeTimers();
  const capture = captureRoomAssertionState(
    { evaluate: () => new Promise(() => {}) } as unknown as Page,
    'ITC-RACK',
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(await capture).toEqual({ available: false });
  expect(
    sanitizedRoomSnapshot({
      status: 'unresolved',
      reason: 'work budget exhausted',
    }),
  ).toEqual({ status: 'unresolved', reason: 'work budget exhausted' });
  expect(vi.getTimerCount()).toBe(0);
});
