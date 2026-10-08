import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useMemo,
  type Ref,
  type ReactNode,
} from 'react';
import {
  Color,
  MeshStandardMaterial,
  LineBasicMaterial,
  type LineBasicMaterialParameters,
  type BufferGeometry,
  type MeshStandardMaterialParameters,
} from 'three';
import { SelectionMaterial } from './selection-material';
import { SceneDepth } from './scene-depth';
import type { RoomDefinition } from '../schema';
import {
  readScenePalette,
  ScenePaletteProvider,
  SelectionEdges,
} from './scene-palette';

const state = vi.hoisted(() => ({
  frame: null as (() => void) | null,
  material: null as MeshStandardMaterial | null,
  gridMaterial: null as LineBasicMaterial | null,
  gridGeometry: null as BufferGeometry | null,
  three: vi.fn(),
  reduced: false,
  edge: vi.fn(),
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => state.three(),
  useFrame: (frame: () => void) => {
    state.frame = frame;
  },
}));
vi.mock('@react-three/drei', () => ({
  Edges: (props: unknown) => {
    state.edge(props);
    return null;
  },
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => state.reduced,
}));

// Replace only the R3F host material with a real Three material, preserving
// React's ref/effect lifecycle without requiring a WebGL renderer in jsdom.
function MaterialProbe({
  ref,
  ...props
}: MeshStandardMaterialParameters & { ref: Ref<MeshStandardMaterial> }) {
  const material = useMemo(() => new MeshStandardMaterial(props), [props]);
  useImperativeHandle(ref, () => material, [material]);
  useEffect(() => {
    state.material = material;
    return () => material.dispose();
  }, [material]);
  return null;
}
function GridMaterialProbe(props: LineBasicMaterialParameters) {
  const material = useMemo(() => new LineBasicMaterial(props), [props]);
  useEffect(() => {
    state.gridMaterial = material;
    return () => material.dispose();
  }, [material]);
  return null;
}
function GridGeometryProbe({
  geometry,
  children,
}: {
  geometry: BufferGeometry;
  children: ReactNode;
}) {
  useEffect(() => {
    state.gridGeometry = geometry;
  }, [geometry]);
  return children;
}
vi.mock('react/jsx-runtime', async () => {
  const actual =
    await vi.importActual<typeof import('react/jsx-runtime')>(
      'react/jsx-runtime',
    );
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => {
      if (args[0] === 'meshStandardMaterial') args[0] = MaterialProbe;
      if (args[0] === 'lineBasicMaterial') args[0] = GridMaterialProbe;
      if (args[0] === 'lineSegments') args[0] = GridGeometryProbe;
      if (args[0] === 'group') args[0] = Fragment;
      return actual.jsx(...args);
    },
  };
});
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<typeof import('react/jsx-dev-runtime')>(
    'react/jsx-dev-runtime',
  );
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (args[0] === 'meshStandardMaterial') args[0] = MaterialProbe;
      if (args[0] === 'lineBasicMaterial') args[0] = GridMaterialProbe;
      if (args[0] === 'lineSegments') args[0] = GridGeometryProbe;
      if (args[0] === 'group') args[0] = Fragment;
      return actual.jsxDEV(...args);
    },
  };
});

let canvas: HTMLCanvasElement;
let invalidate: ReturnType<typeof vi.fn>;
let now: number;
beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  // Use the declared shared palette, then override it as an embedding host can.
  const globals = readFileSync('src/app/globals.css', 'utf8');
  for (const [, token, value] of globals.matchAll(/(--[a-z-]+):\s*([^;]+);/g))
    canvas.style.setProperty(token, value);
  canvas.style.setProperty('--accent', '#c040ff');
  canvas.style.setProperty('--room-selected-edge', 'rgb(80, 210, 30)');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    top: 20,
    bottom: 400,
  } as DOMRect);
  invalidate = vi.fn();
  state.three.mockReturnValue({ gl: { domElement: canvas }, invalidate });
  state.reduced = false;
  state.material = null;
  state.gridMaterial = null;
  state.gridGeometry = null;
  state.frame = null;
  now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  canvas.remove();
  vi.restoreAllMocks();
});

function scene(selected = true, dimmed = false, hovered = false) {
  return (
    <ScenePaletteProvider>
      <SelectionMaterial
        color="#987654"
        selected={selected}
        dimmed={dimmed}
        hovered={hovered}
      />
      <SelectionEdges selected={selected} dimmed={dimmed} />
    </ScenePaletteProvider>
  );
}
function frame(time: number) {
  now = time;
  act(() => state.frame?.());
}

describe('shared room graphics palette', () => {
  it('passes a grid token override into a real line material without changing grid geometry, opacity or scheduling', () => {
    canvas.style.setProperty('--room-grid', 'rgb(230, 120, 15)');
    const room = {
      dimensions: [48, 36, 96],
      nodes: [],
      roomId: 'test-room',
      locationCode: 'TEST',
      camera: { target: [0, 0, 0] },
    } as unknown as RoomDefinition;
    const reads = vi.spyOn(window, 'getComputedStyle');
    const view = render(
      <ScenePaletteProvider>
        <SceneDepth room={room} />
      </ScenePaletteProvider>,
    );
    expect(
      state.gridMaterial?.color.equals(new Color('rgb(230, 120, 15)')),
    ).toBe(true);
    expect(state.gridMaterial?.opacity).toBe(0.45);
    expect(state.gridMaterial?.transparent).toBe(true);
    expect(state.gridGeometry?.getAttribute('position').count).toBe(10);
    expect(state.gridGeometry?.getAttribute('position').getY(0)).toBeCloseTo(
      0.015,
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(state.gridGeometry!, 'dispose');
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('passes overridden semantic tokens into a real Three material and edges while retaining physical material color', () => {
    const reads = vi.spyOn(window, 'getComputedStyle');
    const view = render(scene());
    expect(state.material?.emissive.equals(new Color('#c040ff'))).toBe(true);
    expect(state.material?.color.equals(new Color('#987654'))).toBe(true);
    expect(
      state.edge.mock.calls
        .at(-1)?.[0]
        .color.equals(new Color('rgb(80, 210, 30)')),
    ).toBe(true);
    expect(reads).toHaveBeenCalledTimes(1);
    view.rerender(scene(false, true, true));
    expect(
      state.material?.color.equals(new Color('#987654').multiplyScalar(0.72)),
    ).toBe(true);
    frame(500);
    expect(reads).toHaveBeenCalledTimes(1);
  });
  it('retains the finite 600ms pulse and schedules no further demand frames when settled', () => {
    render(scene());
    invalidate.mockClear();
    frame(400);
    expect(state.material?.emissiveIntensity).toBeCloseTo(0.46);
    expect(invalidate).toHaveBeenCalledTimes(1);
    frame(700);
    expect(state.material?.emissiveIntensity).toBeCloseTo(0.18);
    invalidate.mockClear();
    frame(900);
    expect(invalidate).not.toHaveBeenCalled();
    expect(state.material?.emissiveIntensity).toBeCloseTo(0.18);
  });
  it('keeps Reduced selection and unselected idle static, with no emissive energy for an unselected idle material', () => {
    state.reduced = true;
    const view = render(scene());
    invalidate.mockClear();
    frame(400);
    expect(state.material?.emissiveIntensity).toBe(0.18);
    expect(invalidate).not.toHaveBeenCalled();
    state.reduced = false;
    view.rerender(scene(false));
    invalidate.mockClear();
    frame(500);
    expect(state.material?.emissiveIntensity).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('rejects unsupported CSS color syntax before Three can silently substitute white', () => {
    canvas.style.setProperty('--accent', 'color(srgb 0.2 0.3 0.4)');
    expect(() => readScenePalette(canvas)).toThrow(
      'Unsupported room palette token',
    );
  });
});
