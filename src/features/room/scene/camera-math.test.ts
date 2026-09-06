import { describe, expect, it } from 'vitest';
import { Spherical, Vector3 } from 'three';
import { rotatedOffset } from './camera-math';
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
