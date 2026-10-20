import type { RoomNode } from '../../src/features/room/schema';

/** Choose only a different, physically exposed revealable surface. */
export function chooseRevealWitness(
  nodes: readonly RoomNode[],
  excludedCode: string,
  exposed: ReadonlyMap<string, { x: number; y: number }>,
) {
  const candidates = nodes
    .filter(
      (node) =>
        node.kind === 'box' &&
        node.visual?.style !== 'rack' &&
        node.interaction?.selectable &&
        node.locationCode &&
        node.locationCode !== excludedCode &&
        node.visual?.reveal?.offset.some((value) => value !== 0) &&
        exposed.has(node.locationCode),
    )
    .sort(
      (a, b) =>
        Number(b.visual?.style === 'container') -
          Number(a.visual?.style === 'container') ||
        a.locationCode!.localeCompare(b.locationCode!),
    );
  const node = candidates[0];
  return node
    ? {
        node,
        code: node.locationCode!,
        point: exposed.get(node.locationCode!)!,
      }
    : null;
}
