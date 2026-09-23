import { describe, expect, it } from 'vitest';
import {
  Group,
  MathUtils,
  OrthographicCamera,
  Spherical,
  Vector3,
} from 'three';
import rawRoom from '../../../../data/rooms/it-closet.json';
import { buildRoomBindings, findFocusBinding } from '../bindings';
import { toScenePosition } from '../coordinates';
import { roomSchema } from '../schema';
import {
  cameraFacingLabelPosition,
  cameraFacingDirectionInLocalSpace,
  FREE_POLAR_EPSILON,
  floorDoubleClickAllowed,
  focusZoomForBinding,
  frameBounds,
  guidedOffset,
  nearestGuidedAzimuth,
  recenteredPosition,
  rotatedOffset,
  tiltedOffset,
  zoomForBoundsAroundFocus,
} from './camera-math';
describe('constrained camera rotation', () => {
  it('preserves camera distance and elevation without mutating its inputs', () => {
    const position = new Vector3(20, 80, 120),
      target = new Vector3(5, 10, -40),
      before = position.clone(),
      oldOrbit = new Spherical().setFromVector3(position.clone().sub(target));
    const offset = rotatedOffset(position, target, 0.2, [-0.8, 0.8]),
      orbit = new Spherical().setFromVector3(offset);
    expect(position.equals(before)).toBe(true);
    expect(orbit.radius).toBeCloseTo(oldOrbit.radius);
    expect(orbit.phi).toBeCloseTo(oldOrbit.phi);
    expect(orbit.theta).toBeGreaterThan(oldOrbit.theta);
  });
  it('clamps repeated rotation at both allowed azimuth boundaries', () => {
    const target = new Vector3(0, 0, 0),
      start = new Vector3(0, 30, 80);
    const right = rotatedOffset(start, target, 100, [-0.5, 0.5]);
    expect(new Spherical().setFromVector3(right).theta).toBeCloseTo(0.5);
    expect(right.length()).toBeGreaterThan(0);
    const left = rotatedOffset(right, target, -100, [-0.5, 0.5]);
    expect(new Spherical().setFromVector3(left).theta).toBeCloseTo(-0.5);
    expect(left.length()).toBeCloseTo(start.length());
  });
});

describe('room orbit and framing', () => {
  it('recomputes phone room-fit limits after Fit, Free rotation, then ITC focus', () => {
    const room = roomSchema.parse(rawRoom);
    const bindings = buildRoomBindings(room);
    const binding = findFocusBinding(bindings, 'ITC')!;
    const viewport = { width: 360, height: 580 };
    const canonical = new Vector3(...toScenePosition(room.camera.target));
    const elevation = MathUtils.degToRad(room.camera.elevationDegrees);
    const axesAt = (angle: number) => {
      const camera = new OrthographicCamera(-180, 180, 290, -290);
      camera.position
        .copy(canonical)
        .add(
          new Vector3(
            Math.sin(angle) * Math.cos(elevation) * 400,
            Math.sin(elevation) * 400,
            Math.cos(angle) * Math.cos(elevation) * 400,
          ),
        );
      camera.lookAt(canonical);
      camera.updateMatrixWorld();
      return {
        right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
        up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
      };
    };
    const initialAxes = axesAt(0);
    const turnedAxes = axesAt(MathUtils.degToRad(60));
    const bounds = bindings.map((item) => item.bounds);
    const staleFit = frameBounds(
      bounds,
      canonical,
      initialAxes.right,
      initialAxes.up,
      viewport,
      room.camera.fitPadding,
    ).zoom;
    const currentFit = frameBounds(
      bounds,
      canonical,
      turnedAxes.right,
      turnedAxes.up,
      viewport,
      room.camera.fitPadding,
    ).zoom;
    const focus = new Vector3(...toScenePosition(binding.focusPoint));
    const visibleZoom = zoomForBoundsAroundFocus(
      binding.bounds,
      focus,
      turnedAxes.right,
      turnedAxes.up,
      viewport,
      room.camera.fitPadding,
    );
    const staleFocus = focusZoomForBinding(
      binding.bounds,
      focus,
      turnedAxes.right,
      turnedAxes.up,
      viewport,
      room.camera.fitPadding,
      staleFit,
      room.camera.zoomLimits,
    );
    const currentFocus = focusZoomForBinding(
      binding.bounds,
      focus,
      turnedAxes.right,
      turnedAxes.up,
      viewport,
      room.camera.fitPadding,
      currentFit,
      room.camera.zoomLimits,
    );
    expect(staleFocus).toBeGreaterThan(visibleZoom);
    expect(currentFocus).toBeLessThanOrEqual(visibleZoom + 1e-9);
  });

  it('keeps ITC and its left-storage aggregate bounds visible about their contract focus points', () => {
    const room = roomSchema.parse(rawRoom);
    const bindings = buildRoomBindings(room);
    const viewport = { width: 650, height: 580 };
    const canonical = new Vector3(...toScenePosition(room.camera.target));
    const azimuth = MathUtils.degToRad(room.camera.azimuthDegrees);
    const elevation = MathUtils.degToRad(room.camera.elevationDegrees);
    const camera = new OrthographicCamera(-325, 325, 290, -290);
    camera.position
      .copy(canonical)
      .add(
        new Vector3(
          Math.sin(azimuth) * Math.cos(elevation) * 400,
          Math.sin(elevation) * 400,
          Math.cos(azimuth) * Math.cos(elevation) * 400,
        ),
      );
    camera.lookAt(canonical);
    camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const roomFit = frameBounds(
      bindings.map((binding) => binding.bounds),
      canonical,
      right,
      up,
      viewport,
      room.camera.fitPadding,
    ).zoom;
    for (const code of ['ITC', 'ITC-L']) {
      const binding = findFocusBinding(bindings, code)!;
      const focus = new Vector3(...toScenePosition(binding.focusPoint));
      const zoom = focusZoomForBinding(
        binding.bounds,
        focus,
        right,
        up,
        viewport,
        room.camera.fitPadding,
        roomFit,
        room.camera.zoomLimits,
      );
      const visibleZoom = zoomForBoundsAroundFocus(
        binding.bounds,
        focus,
        right,
        up,
        viewport,
        room.camera.fitPadding,
      );
      expect(zoom).toBeLessThanOrEqual(visibleZoom + 1e-9);
      expect(zoom).toBeGreaterThanOrEqual(roomFit * room.camera.zoomLimits[0]);
    }
  });

  it('uses the farthest projected corner when a small binding focus is offset', () => {
    const bounds = {
      min: [0, 0, 0] as [number, number, number],
      max: [10, 10, 10] as [number, number, number],
    };
    const zoom = focusZoomForBinding(
      bounds,
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      { width: 100, height: 100 },
      1,
      10,
      [0.1, 3],
    );
    expect(zoom).toBe(5);
  });
  it('places one side label on the camera-facing face from each room side', () => {
    const size = [16, 12, 14] as const;
    const authored = [8.01, 3, 2] as const;
    expect(
      cameraFacingLabelPosition(size, new Vector3(100, 20, 0), authored),
    ).toEqual([8.8, 2, -3]);
    expect(
      cameraFacingLabelPosition(size, new Vector3(-100, 20, 0), authored),
    ).toEqual([-8.8, 2, -3]);
    expect(
      cameraFacingLabelPosition(size, new Vector3(0, 20, 100), authored),
    ).toEqual([4, 2, 6.8]);
    expect(
      cameraFacingLabelPosition(size, new Vector3(0, 20, -100), authored),
    ).toEqual([4, 2, -6.8]);
    const upper = cameraFacingLabelPosition(
      [16, 24, 3],
      new Vector3(-100, 20, 0),
      [8.01, 6, 0],
    );
    const lower = cameraFacingLabelPosition(
      [16, 24, 7],
      new Vector3(-100, 20, 0),
      [8.01, -6, 0],
    );
    expect(upper[2]).toBe(-6);
    expect(lower[2]).toBe(6);
  });
  it('places labels on top and bottom faces at steep Free elevations', () => {
    const size = [16, 12, 14] as const;
    const anchor = [8.01, 3, 2] as const;
    expect(
      cameraFacingLabelPosition(size, new Vector3(1, 100, 1), anchor),
    ).toEqual([8, 7.8, -3]);
    expect(
      cameraFacingLabelPosition(size, new Vector3(1, -100, 1), anchor),
    ).toEqual([8, -7.8, -3]);
  });
  it('keeps a transformed label facing the same side as an orthographic camera pans', () => {
    const parent = new Group();
    parent.position.set(200, 0, 0);
    parent.rotation.y = Math.PI / 2;
    const origin = new Group();
    parent.add(origin);
    const camera = new OrthographicCamera(-10, 10, 10, -10);
    const target = new Vector3(0, 0, 0);
    camera.position.set(100, 0, 0);
    camera.lookAt(target);
    const before = cameraFacingDirectionInLocalSpace(camera, origin);
    expect(before.x).toBeCloseTo(0);
    expect(before.z).toBeCloseTo(1);
    const positionBefore = cameraFacingLabelPosition(
      [16, 12, 14],
      before,
      [8.01, 3, 2],
    );
    camera.position.add(new Vector3(300, 15, -200));
    target.add(new Vector3(300, 15, -200));
    camera.lookAt(target);
    const after = cameraFacingDirectionInLocalSpace(camera, origin);
    expect(after.distanceTo(before)).toBeLessThan(1e-10);
    expect(
      cameraFacingLabelPosition([16, 12, 14], after, [8.01, 3, 2]),
    ).toEqual(positionBefore);
    expect(positionBefore).toEqual([4, 2, 6.8]);
  });

  it('rejects a floor double-click during or just after manual camera movement', () => {
    expect(floorDoubleClickAllowed(2, false, -Infinity, 1000)).toBe(true);
    expect(floorDoubleClickAllowed(6, false, -Infinity, 1000)).toBe(false);
    expect(floorDoubleClickAllowed(2, true, 900, 1000)).toBe(false);
    expect(floorDoubleClickAllowed(2, false, 900, 1200)).toBe(false);
    expect(floorDoubleClickAllowed(2, false, 900, 1401)).toBe(true);
  });
  it('rotates through either seam and beyond a full revolution without changing elevation or radius', () => {
    const target = new Vector3(3, 4, 5);
    const start = new Vector3(3, 34, 105);
    for (const direction of [-1, 1]) {
      let position = start.clone();
      for (let step = 0; step < 50; step++)
        position = target
          .clone()
          .add(
            rotatedOffset(position, target, (direction * Math.PI) / 20, [
              -Infinity,
              Infinity,
            ]),
          );
      const expected = target
        .clone()
        .add(
          rotatedOffset(start, target, direction * 2.5 * Math.PI, [
            -Infinity,
            Infinity,
          ]),
        );
      expect(position.distanceTo(expected)).toBeLessThan(1e-8);
      expect(position.distanceTo(target)).toBeCloseTo(start.distanceTo(target));
      expect(position.y).toBeCloseTo(start.y);
    }
  });

  it('returns to the nearest equivalent Guided angle after free rotation', () => {
    expect(nearestGuidedAzimuth(2 * Math.PI + 0.2, [-0.5, 0.5])).toBeCloseTo(
      0.2,
    );
    expect(nearestGuidedAzimuth(-2 * Math.PI - 0.9, [-0.5, 0.5])).toBeCloseTo(
      -0.5,
    );
    expect(nearestGuidedAzimuth(Math.PI, [-0.5, 0.5])).toBeCloseTo(0.5);
  });
  it('tilts through the horizon into below-floor views while respecting pole gaps', () => {
    const target = new Vector3(3, 4, 5);
    let position = target.clone().add(new Vector3(0, 30, 100));
    const radius = position.distanceTo(target);
    for (let step = 0; step < 12; step++)
      position = target
        .clone()
        .add(
          tiltedOffset(position, target, Math.PI / 12, [
            FREE_POLAR_EPSILON,
            Math.PI - FREE_POLAR_EPSILON,
          ]),
        );
    const polar = new Spherical().setFromVector3(position.clone().sub(target));
    expect(polar.phi).toBeGreaterThan(Math.PI / 2);
    expect(polar.phi).toBeLessThan(Math.PI);
    expect(position.distanceTo(target)).toBeCloseTo(radius);
    const pole = tiltedOffset(position, target, Math.PI, [
      FREE_POLAR_EPSILON,
      Math.PI - FREE_POLAR_EPSILON,
    ]);
    expect(new Spherical().setFromVector3(pole).phi).toBeCloseTo(
      Math.PI - FREE_POLAR_EPSILON,
    );
  });

  it('returns to Guided by clamping azimuth and elevation together', () => {
    const target = new Vector3(0, 0, 0);
    const position = new Vector3().setFromSpherical(
      new Spherical(100, MathUtils.degToRad(145), Math.PI),
    );
    const result = guidedOffset(position, target, [-0.5, 0.5], [20, 65]);
    const guided = new Spherical().setFromVector3(result);
    expect(guided.theta).toBeCloseTo(0.5);
    expect(guided.phi).toBeCloseTo(MathUtils.degToRad(70));
    expect(guided.radius).toBeCloseTo(100);
    expect(position.y).toBeLessThan(0);
  });

  it('recenters the pivot while preserving offset and leaving source vectors untouched', () => {
    const camera = new Vector3(30, 80, 120),
      target = new Vector3(5, 10, -20),
      canonical = new Vector3(42, 35, -63);
    const before = camera.clone().sub(target);
    const recentered = recenteredPosition(camera, target, canonical);
    expect(recentered.clone().sub(canonical).distanceTo(before)).toBeLessThan(
      1e-10,
    );
    expect(camera.toArray()).toEqual([30, 80, 120]);
    expect(target.toArray()).toEqual([5, 10, -20]);
  });

  it('fits projected room geometry to the actual canvas and current orientation', () => {
    const bounds = [
      {
        min: [0, 0, 0] as [number, number, number],
        max: [100, 60, 80] as [number, number, number],
      },
    ];
    const target = new Vector3(0, 0, 0);
    const front = frameBounds(
      bounds,
      target,
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      { width: 300, height: 500 },
      1.2,
    );
    const narrow = frameBounds(
      bounds,
      target,
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      { width: 150, height: 500 },
      1.2,
    );
    const side = frameBounds(
      bounds,
      target,
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0),
      { width: 300, height: 500 },
      1.2,
    );
    expect(narrow.zoom).toBeLessThan(front.zoom);
    expect(side.zoom).toBeGreaterThan(front.zoom);
    expect(front.target.toArray()).toEqual([50, 40, 0]);
  });
});
