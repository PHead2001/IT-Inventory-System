import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useImperativeHandle, useMemo, type Ref } from 'react';
import {
  Color,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
} from 'three';
import { SelectionMaterial } from './selection-material';
import {
  readScenePalette,
  ScenePaletteProvider,
  SelectionEdges,
} from './scene-palette';

const state = vi.hoisted(() => ({
  frame: null as (() => void) | null,
  material: null as MeshStandardMaterial | null,
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
vi.mock('react/jsx-runtime', async () => {
  const actual =
    await vi.importActual<typeof import('react/jsx-runtime')>(
      'react/jsx-runtime',
    );
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => {
      if (args[0] === 'meshStandardMaterial') args[0] = MaterialProbe;
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
