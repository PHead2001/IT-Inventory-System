'use client';
import { useEffect, useMemo } from 'react';
import {
  DataTexture,
  RGBAFormat,
  LinearFilter,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three';
import type { RoomDefinition } from '../schema';
import { useScenePalette } from './scene-palette';
import { SCENE_EFFECTS } from './scene-effects-state';

/** Static corner grounding and grid. Furniture contacts belong to the cached capture. */
export function SceneDepth({ room }: { room: RoomDefinition }) {
  const palette = useScenePalette();
  const texture = useMemo(() => {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const radius = Math.max(
          Math.abs(((x + 0.5) / size) * 2 - 1),
          Math.abs(((y + 0.5) / size) * 2 - 1),
        );
        const alpha = Math.pow(Math.max(0, 1 - radius), 0.7) * 100;
        pixels.set([0, 0, 0, alpha], (y * size + x) * 4);
      }
    const result = new DataTexture(pixels, size, size, RGBAFormat);
    result.magFilter = LinearFilter;
    result.needsUpdate = true;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const grid = useMemo(() => {
    const [width, depth] = room.dimensions;
    const points: number[] = [];
    for (let x = 12; x < width; x += 12)
      points.push(x, 0.015, 0, x, 0.015, -depth);
    for (let y = 12; y < depth; y += 12)
      points.push(0, 0.015, -y, width, 0.015, -y);
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(points, 3));
    return result;
  }, [room]);
  useEffect(() => () => grid.dispose(), [grid]);
  return (
    <group userData={{ roomEffectHelper: true }}>
      {[
        [3, 3],
        [room.dimensions[0] - 3, 3],
        [3, room.dimensions[1] - 3],
        [room.dimensions[0] - 3, room.dimensions[1] - 3],
      ].map(([x, y], index) => (
        <mesh
          key={index}
          position={[x, 0.025, -y]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => {}}
        >
          <planeGeometry args={[12, 12]} />
          <meshBasicMaterial
            map={texture}
            color={palette.grid}
            transparent
            depthWrite={false}
            opacity={0.35 * SCENE_EFFECTS.intensity}
          />
        </mesh>
      ))}
      <lineSegments geometry={grid} raycast={() => {}}>
        <lineBasicMaterial color={palette.grid} transparent opacity={0.45} />
      </lineSegments>
    </group>
  );
}
