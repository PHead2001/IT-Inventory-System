import type { RoomDefinition } from '../schema';
import type { RoomVector } from '../coordinates';
type Opening = Pick<
  RoomDefinition['openings'][number],
  'wall' | 'offset' | 'width'
>;
export function openingTransform(opening: Opening, [width, depth]: RoomVector) {
  const frontBack = opening.wall === 'front' || opening.wall === 'back';
  // Back/left rotations point local +X toward decreasing room coordinates.
  const offset =
    opening.offset +
    (opening.wall === 'back' || opening.wall === 'left' ? opening.width : 0);
  const origin: [number, number, number] = frontBack
    ? [offset, opening.wall === 'front' ? 0 : depth, 0]
    : [opening.wall === 'left' ? 0 : width, offset, 0];
  const rotationY =
    opening.wall === 'front'
      ? 0
      : opening.wall === 'back'
        ? Math.PI
        : opening.wall === 'left'
          ? -Math.PI / 2
          : Math.PI / 2;
  return { origin, rotationY };
}
