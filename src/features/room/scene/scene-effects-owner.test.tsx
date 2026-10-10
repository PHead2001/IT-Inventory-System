import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ACESFilmicToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  BoxGeometry,
  Camera,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { RoomDefinition } from '../schema';
import {
  createSceneEffectsStore,
  type SceneEffectsStore,
} from './scene-effects-state';
import { SceneEffectsOwner } from './scene-effects-owner';

const probe = vi.hoisted(() => ({
  store: null as unknown as SceneEffectsStore,
  canvas: null as unknown as HTMLCanvasElement,
  camera: null as unknown as Camera,
  bloom: vi.fn(),
  invalidate: vi.fn(),
  color: { toneMapping: 0, toneMappingExposure: 0, outputColorSpace: '' },
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    gl: { domElement: probe.canvas, ...probe.color },
    camera: probe.camera,
    invalidate: probe.invalidate,
  }),
  useFrame: () => {},
}));
vi.mock('./scene-effects-context', () => ({
  useSceneEffects: () => probe.store,
}));
vi.mock('./scene-palette', () => ({ useScenePaletteRevision: () => 0 }));
vi.mock('./cached-contact-shadows', () => ({
  CachedContactShadows: () => null,
}));
vi.mock('./scene-bloom', () => ({
  default: (props: unknown) => {
    probe.bloom(props);
    return null;
  },
}));

function setup() {
  probe.store = createSceneEffectsStore('scene:1');
  probe.canvas = document.createElement('canvas');
  probe.camera = new Camera();
  probe.bloom.mockReset();
  probe.invalidate.mockReset();
  probe.color = {
    toneMapping: ACESFilmicToneMapping,
    toneMappingExposure: 1.25,
    outputColorSpace: SRGBColorSpace,
  };
  const mesh = new Mesh(
    new BoxGeometry(2, 2, 2),
    new MeshBasicMaterial({ color: new Color('red') }),
  );
  const group = new Group();
  group.add(mesh);
  probe.store.registerVisual('container', 'ITC-RED', group);
  probe.store.setLight('key', new DirectionalLight());
  return mesh;
}
const room = {
  roomId: 'test',
  dimensions: [100, 100, 96],
} as unknown as RoomDefinition;
afterEach(() => vi.restoreAllMocks());

it('quality and missing model keep normal presentation without loading bloom, while actual selected refs reach the isolated effect', async () => {
  const mesh = setup();
  const view = render(
    <SceneEffectsOwner
      room={room}
      selectedCode="ITC-RED"
      highlightedCodes={[]}
      quality="low"
    />,
  );
  expect(probe.bloom).not.toHaveBeenCalled();
  expect(probe.canvas.dataset.bloomStatus).toBe('quality-off');
  view.rerender(
    <SceneEffectsOwner
      room={room}
      selectedCode="UNKNOWN"
      highlightedCodes={[]}
    />,
  );
  expect(probe.bloom).not.toHaveBeenCalled();
  probe.color.toneMapping = NoToneMapping;
  view.rerender(
    <SceneEffectsOwner
      room={room}
      selectedCode="ITC-RED"
      highlightedCodes={[]}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.bloom).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: [mesh],
      lights: probe.store.getLights(),
      rawColor: {
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.25,
        outputColorSpace: SRGBColorSpace,
      },
    }),
  );
});

it('isolates a throwing lazy effect, retains ordinary controls and latches failure across selection changes', async () => {
  setup();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  probe.bloom.mockImplementation(() => {
    throw new Error('Allocation failed');
  });
  const view = render(
    <>
      <button>Select location</button>
      <SceneEffectsOwner
        room={room}
        selectedCode="ITC-RED"
        highlightedCodes={[]}
      />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('button', { name: 'Select location' })).toBeEnabled();
  expect(probe.store.getSnapshot().bloomFailure).toBe('import-or-allocation');
  const failedCalls = probe.bloom.mock.calls.length;
  view.rerender(
    <>
      <button>Select location</button>
      <SceneEffectsOwner
        room={room}
        selectedCode={null}
        highlightedCodes={[]}
      />
    </>,
  );
  view.rerender(
    <>
      <button>Select location</button>
      <SceneEffectsOwner
        room={room}
        selectedCode="ITC-RED"
        highlightedCodes={[]}
      />
    </>,
  );
  expect(probe.bloom).toHaveBeenCalledTimes(failedCalls);
  expect(probe.store.selectedMeshes('ITC-RED', new Set())).toHaveLength(1);
});
