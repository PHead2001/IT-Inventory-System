'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { Color } from 'three';

const paletteTokens = {
  selectionEmissive: '--room-selection-emissive',
  selectedEdge: '--room-selected-edge',
  dimmedEdge: '--room-dimmed-edge',
  edge: '--room-edge',
  background: '--room-canvas-background',
  fillLight: '--room-fill-light',
} as const;
type ScenePalette = { [Key in keyof typeof paletteTokens]: Color };
const PaletteContext = createContext<ScenePalette | null>(null);

export function readScenePalette(element: Element): ScenePalette {
  const style = getComputedStyle(element);
  function resolve(token: string, remaining = 8): string {
    const value = style.getPropertyValue(token).trim();
    const alias = /^var\((--[a-z-]+)\)$/.exec(value);
    if (alias && remaining > 0) return resolve(alias[1], remaining - 1);
    // Three's Color accepts hex and legacy comma-separated rgb(), not CSS
    // color-mix()/color(srgb). Keep the graphics tokens in that shared subset.
    if (
      !/^(?:#[\da-f]{3}|#[\da-f]{6}|rgb\(\s*\d+(?:\.\d+)?%?\s*,\s*\d+(?:\.\d+)?%?\s*,\s*\d+(?:\.\d+)?%?\s*\))$/i.test(
        value,
      )
    )
      throw new Error(`Unsupported room palette token: ${token}`);
    return value;
  }
  return Object.fromEntries(
    Object.entries(paletteTokens).map(([key, token]) => [
      key,
      new Color(resolve(token)),
    ]),
  ) as ScenePalette;
}

export function ScenePaletteProvider({ children }: { children: ReactNode }) {
  const { gl } = useThree();
  // Read at the Canvas boundary, synchronously before any materials render.
  // Rerenders and demand-frame callbacks reuse these same resolved Colors.
  const palette = useMemo(
    () => readScenePalette(gl.domElement),
    [gl.domElement],
  );
  return <PaletteContext value={palette}>{children}</PaletteContext>;
}

export function useScenePalette() {
  const palette = useContext(PaletteContext);
  if (!palette) throw new Error('Room scene palette provider is required');
  return palette;
}

export function SelectionEdges({
  selected,
  dimmed,
}: {
  selected: boolean;
  dimmed: boolean;
}) {
  const palette = useScenePalette();
  return (
    <Edges
      color={
        selected
          ? palette.selectedEdge
          : dimmed
            ? palette.dimmedEdge
            : palette.edge
      }
      threshold={15}
    />
  );
}

export function ScenePaletteLighting() {
  const palette = useScenePalette();
  return (
    <>
      <color attach="background" args={[palette.background]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[100, 220, 100]} intensity={2} />
      <directionalLight
        position={[-80, 100, -100]}
        intensity={0.7}
        color={palette.fillLight}
      />
    </>
  );
}
