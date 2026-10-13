import { expect, it } from 'vitest';
import type { RoomNode } from '../../src/features/room/schema';
import { chooseRevealWitness } from '../e2e/spatial-witness-choice';
const node = (code: string, container = false): RoomNode => ({
  id: code,
  kind: 'box',
  position: [0, 0, 0],
  rotationZDegrees: 0,
  size: [1, 1, 1],
  locationCode: code,
  interaction: {
    selectable: true,
    primaryBinding: true,
    label: code,
    focusPoint: [0, 0, 0],
  },
  visual: {
    color: '#334155',
    opacity: 1,
    edges: true,
    style: container ? 'container' : 'drawer',
    reveal: { offset: [1, 0, 0] },
  },
});
it('prefers a witnessed container deterministically over other revealable surfaces', () => {
  const nodes = [node('SHELF'), node('RED', true), node('BLACK', true)];
  const points = new Map(
    nodes.map((node, index) => [node.locationCode!, { x: index, y: index }]),
  );
  expect(chooseRevealWitness(nodes, 'OLD', points)).toMatchObject({
    code: 'BLACK',
    point: { x: 2, y: 2 },
  });
});
it('requires a different selectable revealable surface with an actual uncovered witness', () => {
  const old = node('OLD'),
    hidden = node('HIDDEN', true),
    rack = {
      ...node('RACK'),
      visual: { ...node('RACK').visual!, style: 'rack' as const },
    },
    disabled = {
      ...node('DISABLED'),
      interaction: { ...node('DISABLED').interaction!, selectable: false },
    },
    shelf = node('SHELF');
  const points = new Map(
    ['OLD', 'RACK', 'DISABLED', 'SHELF'].map((code) => [code, { x: 1, y: 2 }]),
  );
  expect(
    chooseRevealWitness([old, hidden, rack, disabled, shelf], 'OLD', points)
      ?.code,
  ).toBe('SHELF');
});
it('returns no substitute when no different physical revealable surface is witnessed', () => {
  expect(
    chooseRevealWitness(
      [node('OLD'), node('HIDDEN')],
      'OLD',
      new Map([['OLD', { x: 1, y: 2 }]]),
    ),
  ).toBeNull();
});
