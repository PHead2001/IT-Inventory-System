import type { LocationRef } from '../inventory/contracts-ui';
import { buildRoomBindings } from './bindings';
import { containingSpace, spaceRoom, spaces } from './spaces';

// Git-owned static geometry/bindings only; never import renderer/GPU modules.
const models = spaces.map((space) => {
  const room = spaceRoom(space);
  const bindings = room ? buildRoomBindings(room) : [];
  return {
    space,
    room,
    bindings,
    codes: new Set(bindings.map((binding) => binding.code)),
  };
});
export function resolveRoomMap(locations: LocationRef[], code: string | null) {
  const containing = containingSpace(locations, code);
  const model = containing
    ? models.find((model) => model.space.id === containing.id)
    : models.find((model) => code && model.codes.has(code));
  return {
    space: containing ?? model?.space ?? null,
    room: model?.room ?? null,
    bindings: model?.bindings ?? [],
    selectedIsBound: Boolean(code && model?.codes.has(code)),
  };
}
export function hasModeledRoomBinding(locations: LocationRef[], code: string) {
  return resolveRoomMap(locations, code).selectedIsBound;
}
