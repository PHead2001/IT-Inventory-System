import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { openingTransform } from './opening-transform';
import { toScenePosition } from '../coordinates';
describe('measured opening placement', () => {
  for (const wall of ['front', 'back', 'left', 'right'] as const)
    it(
      'preserves the measured opening interval on the ' + wall + ' wall',
      () => {
        const opening = { wall, offset: 12, width: 30 };
        const { origin, rotationY } = openingTransform(opening, [84, 126, 102]);
        const start = new Vector3(...toScenePosition(origin));
        const end = new Vector3(opening.width, 0, 0)
          .applyAxisAngle(new Vector3(0, 1, 0), rotationY)
          .add(start);
        const along = (
          wall === 'front' || wall === 'back'
            ? [start.x, end.x]
            : [-start.z, -end.z]
        ).sort((a, b) => a - b);
        expect(along[0]).toBeCloseTo(opening.offset);
        expect(along[1]).toBeCloseTo(opening.offset + opening.width);
        for (const point of [start, end]) {
          expect(point.y).toBeCloseTo(0);
          if (wall === 'front' || wall === 'back')
            expect(-point.z).toBeCloseTo(wall === 'front' ? 0 : 126);
          else expect(point.x).toBeCloseTo(wall === 'left' ? 0 : 84);
        }
      },
    );
  it('keeps the canonical front door origin and outward label orientation unchanged', () => {
    expect(
      openingTransform(
        { wall: 'front', offset: 42, width: 36 },
        [84, 126, 102],
      ),
    ).toEqual({ origin: [42, 0, 0], rotationY: 0 });
  });
});
