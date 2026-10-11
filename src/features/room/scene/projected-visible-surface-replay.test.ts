import { expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Vector2,
  type Side,
} from 'three';
import replay from '../../../../tests/fixtures/room/ci-phone-fit-open-geometry.json';
import {
  ProjectedVisibleSurface,
  defaultSurfaceLimits,
} from './projected-visible-surface';
import { visibleRoomTarget } from './visible-hover';

// Sanitized CI 38104528591 / job 114367093502, d68d333f, fit-open failure.
// The failure-time world is visible, despite a latched hidden result. Keep this
// distinction: this replay does not record the earlier measured DOM masks and
// cannot by itself reproduce or prove the original frame-ordering failure.
it('preserves the physical S3A witness in the captured failure-time world', () => {
  const source = replay.scene;
  const scene = new Group();
  for (const meta of source.meshes) {
    const triangles = source.triangles.filter(
      (t) => t.sourceMesh === meta.index,
    );
    if (!triangles.length) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float64Array(triangles.flatMap((t) => t.vertices)),
        3,
      ),
    );
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ side: triangles[0].side as Side }),
    );
    if (triangles[0].code)
      mesh.userData.roomHoverTarget = {
        code: triangles[0].code,
        label: triangles[0].code,
      };
    mesh.userData.sourceMesh = meta.index;
    scene.add(mesh);
  }
  const camera = new OrthographicCamera(-157.5, 157.5, 204, -204, 0.1, 3000);
  camera.matrixAutoUpdate = false;
  camera.matrix.copy(new Matrix4().fromArray(source.view).invert());
  camera.matrixWorldNeedsUpdate = true;
  camera.projectionMatrix.fromArray(source.projection);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const update = camera.updateWorldMatrix.bind(camera);
  camera.updateWorldMatrix = (...args) => {
    update(...args);
    // Replay the serialized view exactly, without inverse-roundtrip drift.
    camera.matrixWorldInverse.fromArray(source.view);
  };
  const projection = new ProjectedVisibleSurface(scene, camera, {
    ...defaultSurfaceLimits,
    maxMilliseconds: 5000,
  });
  projection.refresh();
  const ray = new Raycaster();
  const owner = (x: number, y: number) => {
    ray.setFromCamera(new Vector2(x, y), camera);
    return visibleRoomTarget(ray.intersectObject(scene, true))?.code;
  };
  expect(
    owner(
      (2 * (279.65577118858323 - 30)) / 315 - 1,
      1 - (2 * (577.3235580722105 - 399.046875)) / 408,
    ),
  ).toBe('ITC-S3A');
  expect(ray.intersectObject(scene, true)[0].object.userData.sourceMesh).toBe(
    33,
  );
  expect(source.meshes[33]).toMatchObject({
    topology: 'triangles',
    geometry: 'box',
  });
  const result = projection.find(
    'ITC-S3A',
    (point) => owner(point.x, point.y) === 'ITC-S3A',
    {
      left: source.frame.x,
      top: source.frame.y,
      right: source.frame.x + source.frame.width,
      bottom: source.frame.y + source.frame.height,
    },
    source.masks,
  );
  expect(result.status).toBe('visible');
  for (const mesh of scene.children as Mesh[]) {
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  }
});
