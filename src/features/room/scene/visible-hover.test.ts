import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { placeHoverTooltip, visibleRoomTarget } from './visible-hover';

function box(parent: Group, depth: number, opacity = 1) {
  const mesh = new Mesh(
    new BoxGeometry(2, 2, 0.5),
    new MeshBasicMaterial({ transparent: opacity < 1, opacity }),
  );
  mesh.position.z = depth;
  parent.add(mesh);
  return mesh;
}

function pointAt(scene: Group) {
  scene.updateMatrixWorld(true);
  return new Raycaster(
    new Vector3(0, 0, 10),
    new Vector3(0, 0, -1),
  ).intersectObjects(scene.children, true);
}

describe('visible room hover', () => {
  it('keeps a long tooltip within a narrow resized viewport', () => {
    const label = { width: 204, height: 64 };
    for (const canvas of [
      { width: 390, height: 440 },
      { width: 228, height: 240 },
    ]) {
      const point = placeHoverTooltip(
        { x: canvas.width - 2, y: canvas.height - 2 },
        canvas,
        label,
      );
      expect(point.left).toBeGreaterThanOrEqual(8);
      expect(point.top).toBeGreaterThanOrEqual(8);
      expect(point.left + label.width).toBeLessThanOrEqual(canvas.width - 8);
      expect(point.top + label.height).toBeLessThanOrEqual(canvas.height - 8);
    }
  });
  it('resolves a nested visible drawer surface to its logical location', () => {
    const scene = new Group();
    const translated = new Group();
    translated.position.x = 3;
    const drawer = new Group();
    drawer.position.x = -3;
    drawer.userData.roomHoverTarget = { code: 'ITC-D01', label: 'Drawer 1' };
    box(drawer, 0);
    translated.add(drawer);
    scene.add(translated);
    expect(visibleRoomTarget(pointAt(scene))).toEqual({
      code: 'ITC-D01',
      label: 'Drawer 1',
    });
  });

  it('does not reveal stock through an opaque floor or another object', () => {
    const scene = new Group();
    const drawer = new Group();
    drawer.userData.roomHoverTarget = { code: 'ITC-D01', label: 'Drawer 1' };
    box(drawer, -2);
    scene.add(drawer);
    box(scene, 1);
    expect(visibleRoomTarget(pointAt(scene))).toBeNull();
  });

  it('ignores the invisible convenience hitbox when finding the visible face', () => {
    const scene = new Group();
    const drawer = new Group();
    drawer.userData.roomHoverTarget = { code: 'ITC-D01', label: 'Drawer 1' };
    box(drawer, 0);
    const hitbox = box(drawer, 2, 0);
    hitbox.userData.hoverPassThrough = true;
    scene.add(drawer);
    expect(visibleRoomTarget(pointAt(scene))?.code).toBe('ITC-D01');
  });
});
