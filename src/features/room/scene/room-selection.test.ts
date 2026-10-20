import { expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { toScenePosition, toSceneSize } from '../coordinates';
import type { RoomNode } from '../schema';
import {
  createRoomSelectionGesture,
  roomSelectionBox,
  roomSelectionTarget,
} from './room-selection';
import { visibleRoomTarget } from './visible-hover';
import { createSceneEffectsStore } from './scene-effects-state';

const node: RoomNode = {
  id: 'drawer',
  kind: 'box',
  position: [0, 0, 0],
  rotationZDegrees: 0,
  size: [2, 2, 2],
  locationCode: 'ITC-D01',
  interaction: {
    selectable: true,
    primaryBinding: true,
    focusPoint: [0, 0, 0],
    label: 'Drawer',
  },
  visual: {
    color: '#777777',
    opacity: 1,
    edges: false,
    reveal: { offset: [4, 0, 0] },
  },
};
function fixture(rotation = 0) {
  const scene = new Group(),
    parent = new Group(),
    owner = new Group(),
    body = new Group();
  parent.position.set(3, 1, -2);
  parent.rotation.y = rotation;
  owner.userData.roomHoverTarget = { code: 'ITC-D01', label: 'Drawer' };
  const volume = roomSelectionBox(node)!;
  const proxy = new Mesh(
    new BoxGeometry(...toSceneSize(volume.size)),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  proxy.position.fromArray(toScenePosition(volume.center));
  proxy.userData = {
    roomSelectionTarget: owner.userData.roomHoverTarget,
    hoverPassThrough: true,
  };
  const visible = new Mesh(
    new BoxGeometry(...toSceneSize(node.size!)),
    new MeshBasicMaterial(),
  );
  body.add(visible);
  owner.add(proxy, body);
  parent.add(owner);
  scene.add(parent);
  const rayAt = (local: Vector3) => {
    scene.updateMatrixWorld(true);
    const point = owner.localToWorld(local.clone());
    const direction = new Vector3(0, 0, -1).transformDirection(
      owner.matrixWorld,
    );
    return new Raycaster(
      point.clone().addScaledVector(direction, -10),
      direction,
    ).intersectObjects(scene.children, true);
  };
  return { scene, owner, body, visible, proxy, rayAt };
}
it.each([0, 0.5, 1])(
  'real rays retain both resting and moved selection at reveal fraction %s',
  (fraction) => {
    const { body, rayAt } = fixture();
    body.position.x = 4 * fraction;
    expect(roomSelectionTarget(rayAt(new Vector3()))?.code).toBe('ITC-D01');
    expect(
      roomSelectionTarget(rayAt(new Vector3(4 * fraction, 0, 0)))?.code,
    ).toBe('ITC-D01');
  },
);
it('keeps the stationary volume in the same nested rotated parent-local frame', () => {
  const { body, proxy, rayAt } = fixture(Math.PI / 2);
  const rest = proxy.position.clone();
  body.position.x = 4;
  expect(proxy.position.equals(rest)).toBe(true);
  expect(roomSelectionTarget(rayAt(new Vector3()))?.code).toBe('ITC-D01');
  expect(roomSelectionTarget(rayAt(new Vector3(4, 0, 0)))?.code).toBe(
    'ITC-D01',
  );
});
it('near opaque/unbound furniture blocks proxies; hidden furniture does not', () => {
  const { owner, body, rayAt } = fixture();
  body.position.x = 4;
  const blocker = new Mesh(new BoxGeometry(2, 2, 1), new MeshBasicMaterial());
  blocker.position.z = 2;
  owner.add(blocker);
  // Clear inherited logical ownership for independent unbound furniture.
  delete owner.userData.roomHoverTarget;
  expect(roomSelectionTarget(rayAt(new Vector3()))).toBeNull();
  blocker.visible = false;
  expect(roomSelectionTarget(rayAt(new Vector3()))?.code).toBe('ITC-D01');
  owner.visible = false;
  expect(roomSelectionTarget(rayAt(new Vector3()))).toBeNull();
});
it('actual surfaces win equal-depth proxy ties, including unbound blockers', () => {
  const { owner, rayAt } = fixture();
  delete owner.userData.roomHoverTarget;
  expect(roomSelectionTarget(rayAt(new Vector3()))).toBeNull();
});
it('ineligible proxies cannot select; hidden proxies and hover/effects remain independent', () => {
  const { owner, body, proxy, visible, rayAt } = fixture();
  body.position.x = 4;
  expect(roomSelectionTarget(rayAt(new Vector3()), () => false)).toBeNull();
  expect(visibleRoomTarget(rayAt(new Vector3()))).toBeNull();
  const effects = createSceneEffectsStore('selection-test');
  effects.registerVisual('drawer', 'ITC-D01', owner);
  expect(effects.getCasters().map((entry) => entry.mesh)).toEqual([visible]);
  expect(effects.selectedMeshes('ITC-D01', new Set())).toEqual([visible]);
  proxy.visible = false;
  expect(roomSelectionTarget(rayAt(new Vector3()))).toBeNull();
  effects.dispose();
});
it('honors explicit hitbox center/size without inventing volumes for nonrevealing boxes', () => {
  const hitBox = {
    center: [1, 2, 3] as [number, number, number],
    size: [4, 5, 6] as [number, number, number],
  };
  expect(
    roomSelectionBox({
      ...node,
      interaction: { ...node.interaction!, selectable: true, hitBox },
    }),
  ).toBe(hitBox);
  expect(roomSelectionBox({ ...node, visual: undefined })).toBeNull();
  expect(
    roomSelectionBox({
      ...node,
      interaction: { ...node.interaction!, selectable: false },
    }),
  ).toBeNull();
});
it.each([
  'drag',
  'cancel',
  'different-pointer',
  'different-owner',
  'no-up',
  'denied',
] as const)('rejects %s and consumes stale down/up ownership', (reason) => {
  const gesture = createRoomSelectionGesture();
  gesture.down('ITC-D01', 7);
  if (reason !== 'no-up')
    gesture.up(
      reason === 'different-owner' ? 'ITC-D07' : 'ITC-D01',
      reason === 'different-pointer' ? 8 : 7,
    );
  if (reason === 'cancel') gesture.cancel();
  expect(
    gesture.click('ITC-D01', reason === 'drag' ? 6 : 0, reason !== 'denied'),
  ).toBe(false);
  expect(gesture.click('ITC-D01', 0, true)).toBe(false);
});
it('permits the same logical owner across resting down and moved-body up/click', () => {
  const gesture = createRoomSelectionGesture();
  gesture.down('ITC-D01', 2);
  gesture.up('ITC-D01', 2);
  expect(gesture.click('ITC-D01', 0, true)).toBe(true);
  expect(gesture.click('ITC-D01', 0, true)).toBe(false);
});
