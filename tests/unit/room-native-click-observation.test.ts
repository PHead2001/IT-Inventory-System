import { afterEach, expect, it, vi } from 'vitest';
import type { JSHandle, Page } from '@playwright/test';
import { OrthographicCamera, Scene } from 'three';
import {
  observeNativeRoomClick,
  originalClickAgreement,
  projectNativeClickPhases,
  type NativeRoomClickPhase,
} from '../e2e/room-native-click-observation';
import {
  roomWitnessCodeAtPoint,
  type WitnessSnapshot,
  type WitnessTriangle,
} from '../e2e/room-visibility-witness';

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, '__roomWitnessStores');
  vi.restoreAllMocks();
});

function plane(
  code: string,
  left: number,
  right: number,
  z = 0,
): WitnessTriangle[] {
  return [
    { code, side: 0, vertices: [left, -1, z, right, -1, z, right, 1, z] },
    { code, side: 0, vertices: [left, -1, z, right, 1, z, left, 1, z] },
  ];
}

function snapshot(triangles: WitnessTriangle[]): WitnessSnapshot {
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    triangles,
    view: camera.matrixWorldInverse.toArray(),
    projection: camera.projectionMatrix.toArray(),
    frame: { x: 0, y: 0, width: 400, height: 400 },
    masks: [],
  };
}

function phase(scene: WitnessSnapshot): NativeRoomClickPhase {
  return {
    phase: 'pointerdown',
    trusted: true,
    target: 'canvas',
    targetLocationCode: null,
    client: { x: 100, y: 200 },
    offset: { x: 100, y: 200 },
    frame: { ...scene.frame },
    size: { width: 400, height: 400 },
    view: [...scene.view],
    projection: [...scene.projection],
    worldTransformsUnchanged: true,
    moreExpanded: true,
    panel: {
      placement: 'inline',
      frame: { x: 0, y: -200, width: 400, height: 200 },
    },
  };
}

it('distinguishes a visible fractional hover from a native click miss before the gesture', () => {
  const scene = snapshot(plane('ITC-S1A', -0.997, 1));
  const original = structuredClone(scene);
  const result = originalClickAgreement(scene, scene, 'ITC-S1A', {
    x: 100.6,
    y: 200.4,
  });
  expect(result).toMatchObject({
    hoverPhysical: 'ITC-S1A',
    hoverSelection: 'ITC-S1A',
    normalizedClickAgrees: false,
  });
  expect(
    originalClickAgreement(scene, scene, 'ITC-S1A', { x: 101.9, y: 200.4 })
      .normalizedClickAgrees,
  ).toBe(true);
  expect(scene).toEqual(original);
});

it('does not mistake physical hover for agreement with a nearer selection proxy', () => {
  const physical = snapshot(plane('ITC-S1A', -2, 2));
  const selection = {
    ...physical,
    triangles: [...physical.triangles, ...plane('ITC-RED', -2, 0, 1)],
  };
  expect(
    originalClickAgreement(physical, selection, 'ITC-S1A', { x: 100, y: 200 }),
  ).toMatchObject({
    hoverPhysical: 'ITC-S1A',
    hoverSelection: 'ITC-RED',
    normalizedClickAgrees: false,
  });
});

it('exposes changed native canvas and panel frames without claiming bound owners', () => {
  const scene = snapshot([
    ...plane('ITC-S1A', -2, 0),
    ...plane('ITC-RED', 0, 2),
  ]);
  const down = phase(scene);
  const up = {
    ...phase(scene),
    phase: 'pointerup' as const,
    frame: { ...scene.frame, x: -200 },
    offset: { x: 300, y: 200 },
    moreExpanded: false,
    panel: { placement: 'closed' as const, frame: null },
  };
  const before = structuredClone({ scene, down, up });
  const [first, second] = projectNativeClickPhases([down, up]);
  expect(first.frame.x).toBe(0);
  expect(second.frame.x).toBe(-200);
  expect(first.moreExpanded).toBe(true);
  expect(second.moreExpanded).toBe(false);
  expect(first.ownerProjection).toEqual({
    epoch: 'unbound',
    physical: null,
    selection: null,
  });
  expect(second.ownerProjection).toEqual(first.ownerProjection);
  expect({ scene, down, up }).toEqual(before);
});

it('never treats post-hover stable transforms as binding older pre-hover geometry', () => {
  // These world triangles model two meshes changing their world transforms
  // between the original capture and observer installation, then staying put.
  const beforeHover = snapshot([
    ...plane('ITC-S1A', -2, 0),
    ...plane('ITC-RED', 0, 2),
  ]);
  const afterHover = snapshot([
    ...plane('ITC-S1A', 0, 2),
    ...plane('ITC-RED', -2, 0),
  ]);
  const down = phase(afterHover);
  const up = { ...phase(afterHover), phase: 'pointerup' as const };
  expect(roomWitnessCodeAtPoint(beforeHover, down.client)).toBe('ITC-S1A');
  expect(roomWitnessCodeAtPoint(afterHover, down.client)).toBe('ITC-RED');
  expect(down.worldTransformsUnchanged).toBe(true);
  expect(up.worldTransformsUnchanged).toBe(true);
  const result = projectNativeClickPhases([down, up]);
  expect(result.map((item) => item.ownerProjection)).toEqual([
    { epoch: 'unbound', physical: null, selection: null },
    { epoch: 'unbound', physical: null, selection: null },
  ]);
});

it('retains raw transform continuity and never uses a label offset as a canvas ray', () => {
  const scene = snapshot(plane('ITC-S1A', -2, 2));
  const stale = { ...phase(scene), worldTransformsUnchanged: false };
  const label = {
    ...phase(scene),
    phase: 'click' as const,
    target: 'room-label' as const,
    targetLocationCode: 'ITC-S1A',
    offset: { x: 1, y: 1 },
  };
  const result = projectNativeClickPhases([stale, label]);
  expect(result[0].worldTransformsUnchanged).toBe(false);
  expect(result[0].ownerProjection).toEqual({
    epoch: 'unbound',
    physical: null,
    selection: null,
  });
  expect(result[1].dispatch).toBeNull();
  expect(result[1].ownerProjection).toEqual(result[0].ownerProjection);
});

it('caps phase count and projects arbitrary geometry owner names to a fixed marker', () => {
  const scene = snapshot(plane('private fixture name', -2, 2));
  const record = phase(scene);
  expect(
    originalClickAgreement(scene, scene, 'ITC-S1A', record.client),
  ).toMatchObject({
    hoverPhysical: 'other-location',
    hoverSelection: 'other-location',
    normalizedClickAgrees: false,
  });
  expect(() =>
    projectNativeClickPhases(Array.from({ length: 5 }, () => record)),
  ).toThrow('phase bound');
});

it('installs only passive capture listeners, ignores untrusted events and releases every listener', async () => {
  const surface = document.createElement('div');
  surface.dataset.roomSurface = 'true';
  const canvas = document.createElement('canvas');
  surface.append(canvas);
  document.body.append(surface);
  const scene = new Scene(),
    camera = new OrthographicCamera();
  Reflect.set(
    window,
    '__roomWitnessStores',
    new Set([
      {
        getState: () => ({
          scene,
          camera,
          gl: { domElement: canvas },
          size: { width: 400, height: 400 },
        }),
      },
    ]),
  );
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const invalidate = vi.fn();
  Reflect.set(scene.userData, 'invalidate', invalidate);
  const fakePage = {
    evaluateHandle: async (callback: () => unknown) => {
      const capture = callback();
      return {
        evaluate: (read: (value: unknown) => unknown) => read(capture),
        dispose: vi.fn(),
      };
    },
  } as unknown as Page;
  const handle = (await observeNativeRoomClick(fakePage)) as JSHandle<{
    read: () => unknown[];
    stop: () => void;
  }>;
  for (const type of ['pointerdown', 'pointerup', 'click', 'pointercancel']) {
    expect(add).toHaveBeenCalledWith(type, expect.any(Function), {
      capture: true,
      passive: true,
    });
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(await handle.evaluate((capture) => capture.read())).toEqual([]);
  // Unit-only browser-event metadata seam: native PointerEvent cancellation has
  // button=-1. This proxy is never used by a browser journey or as trusted proof.
  const cancellation = new MouseEvent('pointercancel', { button: -1 });
  const event = new Proxy(cancellation, {
    get(target, key) {
      if (key === 'isTrusted') return true;
      if (key === 'target') return canvas;
      return Reflect.get(target, key, target);
    },
  });
  const receive = add.mock.calls.find(
    ([type]) => type === 'pointercancel',
  )![1] as EventListener;
  receive(event);
  expect(await handle.evaluate((capture) => capture.read())).toEqual([
    expect.objectContaining({
      phase: 'pointercancel',
      trusted: true,
      target: 'canvas',
    }),
  ]);
  expect(cancellation.defaultPrevented).toBe(false);
  await handle.evaluate((capture) => capture.stop());
  for (const type of ['pointerdown', 'pointerup', 'click', 'pointercancel'])
    expect(remove).toHaveBeenCalledWith(type, expect.any(Function), true);
  expect(invalidate).not.toHaveBeenCalled();
  await handle.dispose();
});
