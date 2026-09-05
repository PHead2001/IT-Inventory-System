export type RoomVector = readonly [number, number, number];
export function toScenePosition([x, y, z]: RoomVector): [
  number,
  number,
  number,
] {
  return [x, z, -y];
}
export function toSceneSize([x, y, z]: RoomVector): [number, number, number] {
  return [x, z, y];
}
