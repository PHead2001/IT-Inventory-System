import { expect, it } from 'vitest';
import { BoxGeometry, Matrix4, OrthographicCamera, Vector3 } from 'three';
import {
  roomVisibilityWitnesses,
  roomVisibilityWitnessReport,
  type WitnessSnapshot,
  type WitnessTriangle,
} from '../e2e/room-visibility-witness';
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
