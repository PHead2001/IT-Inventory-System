import { describe, expect, it } from 'vitest';
import { Group, OrthographicCamera, Vector3 } from 'three';
import { labelPickReservation } from './label-pick-reservation';

function scene() {
  const parent = new Group(),
    origin = new Group(),
    camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  parent.add(origin);
  camera.position.z = 20;
  camera.updateMatrixWorld();
  return {
    parent,
    origin,
    camera,
    viewport: { left: 100, top: 50, width: 200, height: 100 },
  };
}
describe('ray-verified physical anchor packing projection', () => {
  it('reserves a 12px square at the actual transformed anchor without changing it', () => {
    const { parent, origin, camera, viewport } = scene();
    parent.position.set(2, 1, 0);
    origin.position.set(1, 1, 0);
    const anchor = new Vector3(1, 2, 0);
    expect(labelPickReservation(origin, anchor, camera, viewport)).toEqual({
      left: 234,
      top: 74,
      right: 246,
      bottom: 86,
    });
    expect(anchor.toArray()).toEqual([1, 2, 0]);
  });
  it('reads current parent/reveal, camera and viewport transforms instead of an old DOM-label displacement', () => {
    const { parent, origin, camera, viewport } = scene(),
      anchor = new Vector3();
    const first = labelPickReservation(origin, anchor, camera, viewport)!;
    parent.position.x = 2;
    expect(labelPickReservation(origin, anchor, camera, viewport)!.left).toBe(
      first.left + 20,
    );
    camera.position.x = 2;
    camera.updateMatrixWorld();
    expect(labelPickReservation(origin, anchor, camera, viewport)).toEqual(
      first,
    );
    expect(
      labelPickReservation(origin, anchor, camera, {
        ...viewport,
        left: 140,
        width: 400,
      })!.left,
    ).toBe(first.left + 140);
  });
  it('projects the verified local anchor through parent rotation', () => {
    const { parent, origin, camera, viewport } = scene();
    parent.rotation.z = Math.PI / 2;
    origin.position.x = 1;
    const area = labelPickReservation(
      origin,
      new Vector3(1, 0, 0),
      camera,
      viewport,
    )!;
    expect(area.left).toBeCloseTo(194);
    expect(area.top).toBeCloseTo(84);
    expect(area.right - area.left).toBe(12);
    expect(area.bottom - area.top).toBe(12);
  });
  it.each([
    new Vector3(11, 0, 0),
    new Vector3(0, -11, 0),
    new Vector3(0, 0, 30),
    new Vector3(0, 0, -101),
    new Vector3(NaN, 0, 0),
  ])(
    'does not reserve a nonfinite, clipped or off-viewport anchor %s',
    (anchor) => {
      const { origin, camera, viewport } = scene();
      expect(labelPickReservation(origin, anchor, camera, viewport)).toBeNull();
    },
  );
  it('rejects invalid viewport/world projection and unrepresentable screen rectangles', () => {
    const { parent, origin, camera, viewport } = scene(),
      anchor = new Vector3();
    for (const change of [
      { width: 0 },
      { height: -1 },
      { left: NaN },
      { width: Infinity },
      { left: 1e308 },
    ])
      expect(
        labelPickReservation(origin, anchor, camera, {
          ...viewport,
          ...change,
        }),
      ).toBeNull();
    parent.position.x = Infinity;
    expect(labelPickReservation(origin, anchor, camera, viewport)).toBeNull();
  });
});
