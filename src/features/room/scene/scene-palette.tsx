'use client';
import { recordRoomDemand } from './room-demand-diagnostics';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useThree } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { Color, type Light } from 'three';
import { useSceneCurrent } from './scene-current';
import { useOptionalSceneEffects } from './scene-effects-context';

const paletteTokens = {
  selectionEmissive: '--room-selection-emissive',
  selectedEdge: '--room-selected-edge',
  dimmedEdge: '--room-dimmed-edge',
  edge: '--room-edge',
  background: '--room-canvas-background',
  fillLight: '--room-fill-light',
  grid: '--room-grid',
} as const;
type ScenePalette = { [Key in keyof typeof paletteTokens]: Color };
const PaletteContext = createContext<{
  palette: ScenePalette;
  revision: number;
} | null>(null);

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

export function useLiveScenePalette(element: Element) {
  const effects = useOptionalSceneEffects();
  const isCurrent = useSceneCurrent(effects);
  const [state, setState] = useState(() => ({
    palette: isCurrent()
      ? readScenePalette(element)
      : (Object.fromEntries(
          Object.keys(paletteTokens).map((key) => [key, new Color()]),
        ) as ScenePalette),
    revision: 0,
  }));
  useEffect(() => {
    let disposed = false;
    let queued = false;
    const refresh = () => {
      if (!isCurrent() || queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed || !isCurrent()) return;
        let next: ScenePalette;
        try {
          next = readScenePalette(element);
          (element as HTMLElement).dataset.paletteStatus = 'current';
        } catch {
          // Keep the last supported palette if a future theme commits unsupported
          // color syntax; report the boundary without taking down the Canvas.
          (element as HTMLElement).dataset.paletteStatus = 'unsupported-token';
          return;
        }
        setState((previous) => {
          const changed = Object.keys(paletteTokens).some(
            (key) =>
              !previous.palette[key as keyof ScenePalette].equals(
                next[key as keyof ScenePalette],
              ),
          );
          return changed
            ? { palette: next, revision: previous.revision + 1 }
            : previous;
        });
      });
    };
    if (!isCurrent()) return;
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    media?.addEventListener('change', refresh);
    return () => {
      disposed = true;
      observer.disconnect();
      media?.removeEventListener('change', refresh);
    };
  }, [element, isCurrent]);
  return state;
}

export function ScenePaletteProvider({ children }: { children: ReactNode }) {
  const { gl, invalidate } = useThree();
  const state = useLiveScenePalette(gl.domElement);
  const effects = useOptionalSceneEffects();
  const isCurrent = useSceneCurrent(effects);
  useEffect(() => {
    if (isCurrent()) {
      recordRoomDemand(invalidate, 'palette');
      invalidate();
    }
  }, [state.revision, invalidate, isCurrent]);
  return <PaletteContext value={state}>{children}</PaletteContext>;
}

export function useScenePalette() {
  const palette = useContext(PaletteContext);
  if (!palette) throw new Error('Room scene palette provider is required');
  return palette.palette;
}

export function useScenePaletteRevision() {
  const state = useContext(PaletteContext);
  if (!state) throw new Error('Room scene palette provider is required');
  return state.revision;
}

export function SelectionEdges({
  selected,
  dimmed,
  hovered = false,
}: {
  selected: boolean;
  dimmed: boolean;
  hovered?: boolean;
}) {
  const palette = useScenePalette();
  return (
    <Edges
      color={
        selected || hovered
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
  const effects = useOptionalSceneEffects();
  const ambient = useCallback(
    (light: Light | null) => effects?.setLight('ambient', light),
    [effects],
  );
  const key = useCallback(
    (light: Light | null) => effects?.setLight('key', light),
    [effects],
  );
  const fill = useCallback(
    (light: Light | null) => effects?.setLight('fill', light),
    [effects],
  );
  return (
    <>
      <color attach="background" args={[palette.background]} />
      <ambientLight ref={ambient} intensity={1.1} />
      <directionalLight ref={key} position={[100, 220, 100]} intensity={2} />
      <directionalLight
        ref={fill}
        position={[-80, 100, -100]}
        intensity={0.7}
        color={palette.fillLight}
      />
    </>
  );
}
