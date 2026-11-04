import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { Group, Scene, Vector3 } from 'three';
import type { RoomNode } from '../schema';
import { RevealedBody } from './room-scene';

const renderer = vi.hoisted(() => ({
  state: null as unknown,
  frame: null as (() => void) | null,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => renderer.state,
  useFrame: (callback: () => void) => {
    renderer.frame = callback;
  },
}));
vi.mock('./safe-canvas', () => ({ SafeCanvas: () => null }));
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => false,
}));

const node: RoomNode = {
  id: 'reveal-drawer',
  kind: 'box',
  locationCode: 'ITC-D01',
  position: [0, 0, 0],
  rotationZDegrees: 0,
  size: [16, 12, 6],
  visual: {
    color: '#777777',
    opacity: 1,
    edges: true,
    reveal: { offset: [5.6, 0, 0] },
  },
};
let body: Group;
let now: number;
let invalidate: ReturnType<typeof vi.fn>;

function BodyHarness({
  open,
  settle = false,
}: {
  open: boolean;
  settle?: boolean;
}) {
  useLayoutEffect(() => {
    // The DOM host substitutes only for R3F's group creation. Attach a real
    // Three.js position before RevealedBody's production ref/effect logic runs.
    Object.defineProperty(document.querySelector('group'), 'position', {
      value: body.position,
      configurable: true,
    });
  }, []);
  return (
    <RevealedBody node={node} open={open} settle={settle}>
      {null}
    </RevealedBody>
  );
}

beforeEach(() => {
  body = new Group();
  now = 0;
  invalidate = vi.fn();
  renderer.state = { scene: new Scene(), invalidate };
  renderer.frame = null;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

function advanceFrame(at: number) {
  now = at;
  act(() => renderer.frame?.());
}

it('cancels an opening before its first frame when the closed endpoint already matches the ref', () => {
  const view = render(<BodyHarness open={false} />);
  view.rerender(<BodyHarness open />);
  view.rerender(<BodyHarness open={false} />);
  invalidate.mockClear();
  advanceFrame(401);
  advanceFrame(900);
  expect(body.position.toArray()).toEqual([0, 0, 0]);
  expect(invalidate).not.toHaveBeenCalled();
});

it('cancels a closing before its first frame when the open endpoint already matches the ref', () => {
  const view = render(<BodyHarness open settle />);
  expect(body.position.distanceToSquared(new Vector3(5.6, 0, 0))).toBe(0);
  view.rerender(<BodyHarness open={false} />);
  view.rerender(<BodyHarness open />);
  invalidate.mockClear();
  advanceFrame(401);
  advanceFrame(900);
  expect(body.position.distanceToSquared(new Vector3(5.6, 0, 0))).toBe(0);
  expect(invalidate).not.toHaveBeenCalled();
});
