import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { exposedTargetAnchor } from './exposed-anchor';

function fixture() {
  const scene = new Group();
  const owner = new Group();
  owner.userData.roomHoverTarget = { code: 'DRAWER', label: 'Drawer' };
  const origin = new Group();
  owner.add(
    new Mesh(new BoxGeometry(4, 4, 2), new MeshBasicMaterial()),
    origin,
  );
  scene.add(owner);
  const camera = new OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
  camera.position.z = 20;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);
  return { scene, owner, origin, camera };
}
const viewport = { left: 0, top: 0, right: 320, bottom: 320 };
describe('exposed location anchors', () => {
  it.each([
    { cameraPosition: [0, 0, -20], preferred: [0, 0, 1] },
    { cameraPosition: [10, -12, -20], preferred: [0, 0, 0] },
  ])(
    'places the anchor camera-side of the first hit from $cameraPosition',
    ({ cameraPosition, preferred }) => {
      const { scene, origin, camera, owner } = fixture();
      owner.position.set(1, 2, 0);
      owner.rotation.y = 0.3;
      scene.updateMatrixWorld(true);
      camera.position.set(...(cameraPosition as [number, number, number]));
      camera.lookAt(owner.position);
      camera.updateMatrixWorld();
      const anchor = exposedTargetAnchor(
        scene,
        camera,
        origin,
        [4, 4, 2],
        'DRAWER',
        new Vector3(...(preferred as [number, number, number])),
      );
      expect(anchor).not.toBeNull();
      const world = origin.localToWorld(anchor!.clone());
      const projected = world.clone().project(camera);
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
      const hit = ray.intersectObject(scene, true)[0];
      expect(hit).toBeDefined();
      expect(
        world.clone().sub(ray.ray.origin).dot(ray.ray.direction),
      ).toBeLessThan(hit.distance);
      expect(world.distanceTo(hit.point)).toBeCloseTo(0.3);
    },
  );
  it('requires an actual opaque surface even when an invisible picking box is exposed', () => {
    const { scene, owner, origin, camera } = fixture();
    const blocker = new Mesh(new BoxGeometry(8, 8, 1), new MeshBasicMaterial());
    blocker.position.z = 4;
    scene.add(blocker);
    const hit = new Mesh(
      new BoxGeometry(5, 5, 1),
      new MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    hit.position.z = 6;
    hit.userData.hoverPassThrough = true;
    owner.add(hit);
    scene.updateMatrixWorld(true);
    expect(
      exposedTargetAnchor(
        scene,
        camera,
        origin,
        [4, 4, 2],
        'DRAWER',
        new Vector3(0, 0, 1),
      ),
    ).toBeNull();
  });
  it('finds a partially exposed face when its center is hidden, and follows parent transforms', () => {
    const { scene, owner, origin, camera } = fixture();
    const blocker = new Mesh(new BoxGeometry(2, 6, 1), new MeshBasicMaterial());
    blocker.position.z = 4;
    scene.add(blocker);
    scene.updateMatrixWorld(true);
    const found = exposedTargetAnchor(
      scene,
      camera,
      origin,
      [4, 4, 2],
      'DRAWER',
      new Vector3(0, 0, 1),
    );
    expect(found).not.toBeNull();
    expect(Math.abs(found!.x)).toBeGreaterThan(1);
    scene.remove(blocker);
    owner.position.x = 3;
    owner.rotation.z = Math.PI / 2;
    scene.updateMatrixWorld(true);
    expect(
      exposedTargetAnchor(
        scene,
        camera,
        origin,
        [4, 4, 2],
        'DRAWER',
        new Vector3(0, 0, 1),
      ),
    ).not.toBeNull();
    owner.position.x = 20;
    scene.updateMatrixWorld(true);
    expect(
      exposedTargetAnchor(
        scene,
        camera,
        origin,
        [4, 4, 2],
        'DRAWER',
        new Vector3(0, 0, 1),
      ),
    ).toBeNull();
  });
  it('excludes fully overlay-covered faces without excluding partially exposed geometry', () => {
    const { scene, origin, camera } = fixture();
    expect(
      exposedTargetAnchor(
        scene,
        camera,
        origin,
        [4, 4, 2],
        'DRAWER',
        new Vector3(0, 0, 1),
        viewport,
        [viewport],
      ),
    ).toBeNull();
    const found = exposedTargetAnchor(
      scene,
      camera,
      origin,
      [4, 4, 2],
      'DRAWER',
      new Vector3(0, 0, 1),
      viewport,
      [{ left: 150, top: 100, right: 320, bottom: 220 }],
    );
    expect(found).not.toBeNull();
    expect(found!.x).toBeLessThan(0);
  });
});
