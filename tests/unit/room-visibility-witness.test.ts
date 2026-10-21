import { afterEach, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { LineSegments2 } from '../../node_modules/three-stdlib/lines/LineSegments2.js';
import {
  BoxGeometry,
  DataTexture,
  FloatType,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RedFormat,
  RGBAFormat,
  Scene,
  Texture,
  Vector3,
} from 'three';
import {
  roomVisibilityWitnesses,
  roomVisibilityWitnessReport,
  roomRayWitnessAt,
  captureRoomWitness,
  uncoveredRoomWitnesses,
  roomWitnessCodeAtPoint,
  type WitnessSnapshot,
  type WitnessTriangle,
} from '../e2e/room-visibility-witness';
afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, '__roomWitnessStores');
  vi.restoreAllMocks();
});
function capture(
  material: MeshBasicMaterial | MeshBasicMaterial[],
  edges = false,
) {
  const scene = new Scene(),
    camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const target = new Mesh(new BoxGeometry(), material);
  target.userData.roomHoverTarget = { code: 'DRAWER' };
  scene.add(target);
  if (edges) {
    const edge = new LineSegments2();
    edge.geometry.setPositions([100, 100, 0, 101, 100, 0]);
    edge.raycast = () => {};
    edge.userData.roomHoverTarget = { code: 'PHANTOM' };
    scene.add(edge);
  }
  scene.updateMatrixWorld();
  const surface = document.createElement('div'),
    canvas = document.createElement('canvas');
  surface.dataset.roomSurface = 'true';
  surface.append(canvas);
  document.body.append(surface);
  Reflect.set(
    window,
    '__roomWitnessStores',
    new Set([
      { getState: () => ({ scene, camera, gl: { domElement: canvas } }) },
    ]),
  );
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 375, 400),
  );
  // Execute exactly the browser serializer on actual Three objects, without a GPU.
  return captureRoomWitness({
    evaluate: async (
      callback: (argument: unknown) => WitnessSnapshot,
      argument: unknown,
    ) => callback(argument),
  } as unknown as Page);
}
it('captures all six actual BoxGeometry groups with a single material', async () => {
  expect((await capture(new MeshBasicMaterial())).triangles).toHaveLength(12);
});
it('excludes installed Drei edge extrusion triangles while retaining physical owner and mesh provenance', async () => {
  const scene = await capture(new MeshBasicMaterial(), true);
  expect(scene.triangles).toHaveLength(12);
  expect(
    scene.triangles.every(
      (face) => face.code === 'DRAWER' && face.sourceMesh === 0,
    ),
  ).toBe(true);
  expect(scene.meshes).toEqual([
    { index: 0, topology: 'triangles', geometry: 'box' },
  ]);
});
it('uses material indexes for actual BoxGeometry material arrays', async () => {
  const materials = Array.from(
    { length: 6 },
    (_, index) => new MeshBasicMaterial({ visible: index === 4 }),
  );
  expect((await capture(materials)).triangles).toHaveLength(2);
});
it('excludes actual uniformly translucent footprint bytes while retaining opaque furniture', async () => {
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const radius = Math.max(
        Math.abs(((x + 0.5) / 32) * 2 - 1),
        Math.abs(((y + 0.5) / 32) * 2 - 1),
      );
      pixels.set(
        [0, 0, 0, Math.pow(Math.max(0, 1 - radius), 0.7) * 100],
        (y * 32 + x) * 4,
      );
    }
  const footprint = new MeshBasicMaterial({
    transparent: true,
    map: new DataTexture(pixels, 32, 32, RGBAFormat),
  });
  const materials = [
    footprint,
    ...Array.from({ length: 5 }, () => new MeshBasicMaterial()),
  ];
  expect((await capture(materials)).triangles).toHaveLength(10);
});
it('includes uniformly opaque RGBA texture coverage', async () => {
  const texture = new DataTexture(
    new Uint8Array([0, 0, 0, 255]),
    1,
    1,
    RGBAFormat,
  );
  expect(
    (await capture(new MeshBasicMaterial({ transparent: true, map: texture })))
      .triangles,
  ).toHaveLength(12);
});
it.each([
  () =>
    new DataTexture(
      new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]),
      2,
      1,
      RGBAFormat,
    ),
  () => new DataTexture(new Uint8Array([0, 0, 0, 255]), 2, 1, RGBAFormat),
  () => new Texture(),
  () => new DataTexture(new Uint8Array(0), 1025, 1025, RGBAFormat),
  () => new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RedFormat),
  () =>
    new DataTexture(
      new Float32Array([0, 0, 0, 1]),
      1,
      1,
      RGBAFormat,
      FloatType,
    ),
  () => new DataTexture(new Uint8Array(0), 0, 1, RGBAFormat),
])(
  'fails explicitly for mixed, malformed, unsupported or excessive alpha resources %s',
  async (texture) => {
    await expect(
      capture(new MeshBasicMaterial({ transparent: true, map: texture() })),
    ).rejects.toThrow(/alpha coverage/);
  },
);
function plane(
  code: string | null,
  left: number,
  right: number,
  z: number,
): WitnessTriangle[] {
  return [
    { code, side: 0, vertices: [left, -1, z, right, -1, z, right, 1, z] },
    { code, side: 0, vertices: [left, -1, z, right, 1, z, left, 1, z] },
  ];
}
function snapshot(
  triangles: WitnessTriangle[],
  position = [0, 0, 5],
): WitnessSnapshot {
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(...(position as [number, number, number]));
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
it('rejects a physical drawer point owned by a nearer selection proxy and retains an uncovered alternate for that same drawer', async () => {
  const physical = snapshot(plane('ITC-D02', -1, 1, 0));
  const selection = {
    ...physical,
    triangles: [...physical.triangles, ...plane('ITC-D01', -1, 0, 1)],
  };
  const stolen = { x: 150, y: 200 };
  const covered = { x: 275, y: 200 };
  const alternate = { x: 250, y: 200 };
  expect(roomWitnessCodeAtPoint(physical, stolen)).toBe('ITC-D02');
  expect(roomWitnessCodeAtPoint(selection, stolen)).toBe('ITC-D01');
  expect(roomWitnessCodeAtPoint(selection, alternate)).toBe('ITC-D02');
  const surface = document.createElement('div');
  surface.dataset.roomSurface = 'true';
  const canvas = document.createElement('canvas');
  surface.append(canvas);
  document.body.append(surface);
  const prior = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (x: number) => (x === covered.x ? surface : canvas),
  });
  const page = {
    evaluate: async (callback: (points: unknown) => unknown, points: unknown) =>
      callback(points),
  } as unknown as Page;
  const candidates = new Map([['ITC-D02', [stolen, covered, alternate]]]);
  try {
    expect(await uncoveredRoomWitnesses(page, candidates)).toEqual(
      new Map([['ITC-D02', stolen]]),
    );
    expect(await uncoveredRoomWitnesses(page, candidates, selection)).toEqual(
      new Map([['ITC-D02', alternate]]),
    );
  } finally {
    if (prior) Object.defineProperty(document, 'elementFromPoint', prior);
    else Reflect.deleteProperty(document, 'elementFromPoint');
  }
});
it('diagnostic rays independently distinguish target, opaque foreground and the actual shifted pointer', () => {
  const scene = snapshot([
    ...plane('DRAWER', -1, 1, 0),
    ...plane('FRONT', -0.5, 0.5, 1),
  ]);
  const expected = roomVisibilityWitnesses(scene).get('DRAWER')![0];
  expect(roomRayWitnessAt(scene, expected).code).toBe('DRAWER');
  expect(roomRayWitnessAt(scene, { x: 200, y: 200 }).code).toBe('FRONT');
  expect(roomRayWitnessAt(scene, { x: -1, y: 200 })).toEqual({
    code: null,
    distance: null,
    inside: false,
  });
  expect(() => roomRayWitnessAt(scene, { x: NaN, y: 0 })).toThrow(
    'input bound',
  );
});
it('finds partially exposed edge patches even when an opaque unbound blocker hides the center', () => {
  const result = roomVisibilityWitnesses(
    snapshot([...plane('DRAWER', -1, 1, 0), ...plane(null, -0.5, 0.5, 1)]),
  );
  expect(result.has('DRAWER')).toBe(true);
  expect(
    roomVisibilityWitnessReport(
      snapshot([...plane('DRAWER', -1, 1, 0), ...plane(null, -0.5, 0.5, 1)]),
    ).partiallyExposedCodes,
  ).toEqual(['DRAWER']);
  expect(
    result.get('DRAWER')!.every((point) => point.x < 150 || point.x > 250),
  ).toBe(true);
});
it('does not see through opaque blockers or overlay masks', () => {
  expect(
    roomVisibilityWitnesses(
      snapshot([...plane('DRAWER', -1, 1, 0), ...plane(null, -2, 2, 1)]),
    ).size,
  ).toBe(0);
  const masked = snapshot(plane('DRAWER', -1, 1, 0));
  masked.masks = [{ left: 0, top: 0, right: 400, bottom: 400 }];
  expect(roomVisibilityWitnesses(masked).size).toBe(0);
});
it('respects front/back/double material sides rather than accepting every triangle', () => {
  const geometry = plane('DRAWER', -1, 1, 0);
  expect(roomVisibilityWitnesses(snapshot(geometry, [0, 0, -5])).size).toBe(0);
  expect(
    roomVisibilityWitnesses(
      snapshot(
        geometry.map((face) => ({ ...face, side: 1 })),
        [0, 0, -5],
      ),
    ).has('DRAWER'),
  ).toBe(true);
  expect(
    roomVisibilityWitnesses(
      snapshot(
        geometry.map((face) => ({ ...face, side: 2 })),
        [0, 0, -5],
      ),
    ).has('DRAWER'),
  ).toBe(true);
});
it.each([
  [4, 3, 5],
  [0, 5, 0.1],
  [0, -5, 0.1],
])(
  'finds actual transformed surfaces from oblique/overhead/underside %s',
  (...position) => {
    const geometry = new BoxGeometry(1, 1, 1),
      vertices = geometry.getAttribute('position'),
      indices = geometry.index!;
    const world = new Matrix4().makeRotationY(0.4).setPosition(0.4, 0.2, 0);
    const triangles: WitnessTriangle[] = [];
    for (let offset = 0; offset < indices.count; offset += 3)
      triangles.push({
        code: 'DRAWER',
        side: 0,
        vertices: [0, 1, 2].flatMap((delta) =>
          new Vector3()
            .fromBufferAttribute(vertices, indices.getX(offset + delta))
            .applyMatrix4(world)
            .toArray(),
        ),
      });
    expect(
      roomVisibilityWitnesses(snapshot(triangles, position)).has('DRAWER'),
    ).toBe(true);
  },
);
