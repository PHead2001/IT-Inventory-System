import { act, render } from '@testing-library/react';
import {
  Fragment,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  type ReactNode,
  type Ref,
} from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Texture,
  type MeshBasicMaterialParameters,
} from 'three';
import type { RoomDefinition, RoomNode } from '../schema';
import {
  createSceneEffectsStore,
  type SceneEffectsStore,
} from './scene-effects-state';
import { HoveredBody } from './hovered-body';
import { CachedContactShadows } from './cached-contact-shadows';

const state = vi.hoisted(() => ({
  store: null as unknown as SceneEffectsStore,
  three: null as unknown,
  frame: null as (() => void) | null,
  group: null as Group | null,
  receiver: null as Mesh | null,
  material: null as MeshBasicMaterial | null,
  fine: true,
  reduced: false,
  paletteRevision: 0,
  palette: null as unknown as { background: Color; grid: Color },
  resource: null as unknown as {
    texture: Texture;
    capture: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  },
  allocationFails: false,
}));
vi.mock('@react-three/fiber', () => ({
  useThree: () => state.three,
  useFrame: (callback: () => void) => {
    state.frame = callback;
  },
}));
vi.mock('./scene-effects-context', () => ({
  useOptionalSceneEffects: () => state.store,
  useSceneEffects: () => state.store,
  useVisualHoverCode: () => state.store.getSnapshot().hoverCode,
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => state.reduced,
}));
vi.mock('./scene-palette', () => ({
  useScenePalette: () => state.palette,
  useScenePaletteRevision: () => state.paletteRevision,
}));
vi.mock('./contact-capture', () => ({
  createContactCapture: () => {
    if (state.allocationFails) throw new Error('allocation');
    return state.resource;
  },
}));

function GroupProbe({
  ref,
  children,
}: {
  ref: Ref<Group>;
  children: ReactNode;
}) {
  const group = useMemo(() => {
    const result = new Group();
    result.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()));
    return result;
  }, []);
  useImperativeHandle(ref, () => group, [group]);
  useLayoutEffect(() => {
    state.group = group;
  }, [group]);
  return children;
}
function ReceiverProbe({
  ref,
  children,
}: {
  ref: Ref<Mesh>;
  children: ReactNode;
}) {
  const mesh = useMemo(() => {
    const result = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial());
    result.visible = false;
    return result;
  }, []);
  useImperativeHandle(ref, () => mesh, [mesh]);
  useLayoutEffect(() => {
    state.receiver = mesh;
  }, [mesh]);
  return children;
}
function MaterialProbe({
  ref,
}: MeshBasicMaterialParameters & { ref: Ref<MeshBasicMaterial> }) {
  const material = useMemo(() => new MeshBasicMaterial(), []);
  useImperativeHandle(ref, () => material, [material]);
  useLayoutEffect(() => {
    state.material = material;
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
      if (args[0] === 'group') args[0] = GroupProbe;
      if (args[0] === 'mesh') args[0] = ReceiverProbe;
      if (args[0] === 'meshBasicMaterial') args[0] = MaterialProbe;
      if (args[0] === 'planeGeometry') args[0] = Fragment;
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
      if (args[0] === 'group') args[0] = GroupProbe;
      if (args[0] === 'mesh') args[0] = ReceiverProbe;
      if (args[0] === 'meshBasicMaterial') args[0] = MaterialProbe;
      if (args[0] === 'planeGeometry') args[0] = Fragment;
      return actual.jsxDEV(...args);
    },
  };
});

const node: RoomNode = {
  id: 'drawer',
  kind: 'box',
  locationCode: 'ITC-D01',
  position: [0, 0, 0],
  rotationZDegrees: 0,
  size: [16, 12, 6],
  interaction: {
    selectable: true,
    primaryBinding: true,
    label: 'Drawer 1',
    focusPoint: [0, 0, 0],
  },
};
const room = {
  roomId: 'test-room',
  dimensions: [100, 100, 96],
} as unknown as RoomDefinition;
let canvas: HTMLCanvasElement;
let now: number;
let invalidate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  now = 0;
  canvas = document.createElement('canvas');
  invalidate = vi.fn();
  state.three = { scene: new Scene(), gl: { domElement: canvas }, invalidate };
  state.store = createSceneEffectsStore('room:1');
  state.fine = true;
  state.reduced = false;
  state.group = state.receiver = null;
  state.material = null;
  state.frame = null;
  state.paletteRevision = 0;
  state.allocationFails = false;
  state.palette = {
    background: new Color('#07111f'),
    grid: new Color('#355168'),
  };
  state.resource = {
    texture: new Texture(),
    capture: vi.fn(),
    dispose: vi.fn(),
  };
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      matches: state.fine,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => true,
    })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function frame(at: number) {
  now = at;
  act(() => state.frame?.());
}
function hover() {
  return <HoveredBody node={node}>{null}</HoveredBody>;
}

it('lifts only the visual body by 0.1 inches on a fine full-motion pointer, then stops demand frames', () => {
  state.store.reconcileHover('ITC-D01', true);
  render(hover());
  expect(state.store.getSnapshot().casterMotions).toBe(1);
  expect(state.store.getCasters()).toHaveLength(1);
  frame(121);
  expect(state.group?.position.y).toBeCloseTo(0.1);
  expect(state.store.getSnapshot().casterMotions).toBe(0);
  invalidate.mockClear();
  frame(600);
  expect(invalidate).not.toHaveBeenCalled();
  expect(node.position).toEqual([0, 0, 0]);
});
it('cancels both pre-first-frame hover reversals without continuing the obsolete animation', () => {
  const view = render(hover());
  state.store.reconcileHover('ITC-D01', true);
  view.rerender(hover());
  state.store.clearHover();
  view.rerender(hover());
  invalidate.mockClear();
  frame(300);
  expect(state.group?.position.y).toBe(0);
  expect(invalidate).not.toHaveBeenCalled();
  state.store.reconcileHover('ITC-D01', true);
  view.rerender(hover());
  frame(421);
  state.store.clearHover();
  view.rerender(hover());
  state.store.reconcileHover('ITC-D01', true);
  view.rerender(hover());
  invalidate.mockClear();
  frame(900);
  expect(state.group?.position.y).toBeCloseTo(0.1);
  expect(invalidate).not.toHaveBeenCalled();
});
it('does not lift on coarse pointers and immediately returns a running lift to rest under Reduced motion', () => {
  state.fine = false;
  state.store.reconcileHover('ITC-D01', true);
  const view = render(hover());
  frame(500);
  expect(state.group?.position.y).toBe(0);
  state.fine = true;
  view.rerender(hover());
  frame(560);
  expect(state.group!.position.y).toBeGreaterThan(0);
  state.reduced = true;
  view.rerender(hover());
  expect(state.group?.position.y).toBe(0);
  expect(state.store.getSnapshot().casterMotions).toBe(0);
  invalidate.mockClear();
  frame(1000);
  expect(invalidate).not.toHaveBeenCalled();
});

function registerCaster() {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  state.store.registerVisual('red', 'ITC-RED', group);
}
it('hides the old contact map immediately and captures once only after all opening, closing and hover casters settle', () => {
  registerCaster();
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  frame(1);
  frame(2);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  expect(state.receiver?.visible).toBe(true);
  const closing = state.store.beginCasterMotion('reveal:old', 'old');
  const opening = state.store.beginCasterMotion('reveal:red', 'red');
  const lift = state.store.beginCasterMotion('hover:red', 'red', true);
  expect(state.receiver?.visible).toBe(false);
  frame(100);
  closing();
  frame(200);
  opening();
  frame(300);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  lift();
  frame(400);
  expect(state.resource.capture).toHaveBeenCalledTimes(2);
  expect(state.receiver?.visible).toBe(true);
  invalidate.mockClear();
  frame(1000);
  frame(2000);
  expect(state.resource.capture).toHaveBeenCalledTimes(2);
  expect(invalidate).not.toHaveBeenCalled();
  view.unmount();
  expect(state.resource.dispose).toHaveBeenCalledOnce();
});
it('coalesces palette changes during motion to the latest settled capture and ignores non-caster activities', () => {
  registerCaster();
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  frame(1);
  frame(2);
  const finish = state.store.beginCasterMotion('reveal:red', 'red');
  state.paletteRevision = 1;
  view.rerender(<CachedContactShadows room={room} quality="standard" />);
  frame(100);
  state.paletteRevision = 2;
  view.rerender(<CachedContactShadows room={room} quality="standard" />);
  frame(200);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  finish();
  frame(400);
  expect(state.resource.capture).toHaveBeenCalledTimes(2);
  const camera = state.store.beginActivity('camera-and-counts');
  frame(500);
  camera();
  frame(600);
  expect(state.resource.capture).toHaveBeenCalledTimes(2);
  expect(canvas.dataset.contactCacheKey).toContain(':2:standard');
});
it('latches capture failure, disposes owned resources and never retries on subsequent demand frames', () => {
  registerCaster();
  state.resource.capture.mockImplementation(() => {
    throw new Error('GPU');
  });
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  frame(1);
  frame(2);
  frame(3);
  frame(400);
  expect(state.receiver?.visible).toBe(false);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  expect(state.resource.dispose).toHaveBeenCalledOnce();
  expect(state.store.getSnapshot().captures).toBe(0);
  expect(canvas.dataset.contactCacheKey).toBeUndefined();
  expect(canvas.dataset.contactStatus).toBe('failed');
  state.paletteRevision++;
  view.rerender(<CachedContactShadows room={room} quality="standard" />);
  const finish = state.store.beginCasterMotion('hover:red', 'red', true);
  finish();
  frame(500);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  view.unmount();
  expect(state.resource.dispose).toHaveBeenCalledOnce();
});

it('removes a previously cached key after a later capture failure and gives a successor a fresh lifetime', () => {
  registerCaster();
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  frame(1);
  frame(2);
  const old = state.resource;
  const oldMaterial = state.material;
  expect(canvas.dataset.contactStatus).toBe('cached');
  expect(oldMaterial?.map).toBe(old.texture);
  old.capture.mockImplementation(() => {
    throw new Error('incomplete framebuffer');
  });
  state.paletteRevision++;
  view.rerender(<CachedContactShadows room={room} quality="standard" />);
  frame(3);
  expect(canvas.dataset.contactStatus).toBe('capture-failed');
  expect(canvas.dataset.contactCacheKey).toBeUndefined();
  expect(state.receiver?.visible).toBe(false);
  expect(state.material?.map).toBeNull();
  expect(state.store.getSnapshot().captures).toBe(1);
  view.unmount();
  expect(oldMaterial?.map).toBeNull();
  expect(old.dispose).toHaveBeenCalledOnce();
  state.resource = {
    texture: new Texture(),
    capture: vi.fn(),
    dispose: vi.fn(),
  };
  const successor = render(
    <CachedContactShadows room={room} quality="standard" />,
  );
  frame(4);
  frame(5);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  expect(canvas.dataset.contactStatus).toBe('cached');
  expect(state.receiver?.visible).toBe(true);
  expect(state.material?.map).toBe(state.resource.texture);
  successor.unmount();
  expect(state.resource.dispose).toHaveBeenCalledOnce();
});

it('latches allocation failure without recording success or attempting capture', () => {
  registerCaster();
  state.allocationFails = true;
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  expect(canvas.dataset.contactStatus).toBe('allocation-failed');
  frame(1);
  frame(2);
  frame(300);
  expect(state.receiver?.visible).toBe(false);
  expect(state.resource.capture).not.toHaveBeenCalled();
  expect(state.store.getSnapshot().captures).toBe(0);
  view.unmount();
});

it('resets a failed capture lifetime when a same-sized room replaces the effects store without unmounting', () => {
  registerCaster();
  const failedResource = state.resource;
  failedResource.capture.mockImplementation(() => {
    throw new Error('shader failure');
  });
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  frame(1);
  frame(2);
  expect(failedResource.dispose).toHaveBeenCalledOnce();
  expect(state.receiver?.visible).toBe(false);
  const receiver = state.receiver;

  state.store = createSceneEffectsStore('room:2');
  registerCaster();
  state.resource = {
    texture: new Texture(),
    capture: vi.fn(),
    dispose: vi.fn(),
  };
  const nextRoom = { ...room, roomId: 'next-room' };
  view.rerender(<CachedContactShadows room={nextRoom} quality="standard" />);
  expect(state.receiver).toBe(receiver);
  frame(3);
  expect(state.resource.capture).not.toHaveBeenCalled();
  frame(4);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  expect(state.store.getSnapshot().captures).toBe(1);
  expect(state.receiver?.visible).toBe(true);
  expect(canvas.dataset.contactStatus).toBe('cached');
  expect(canvas.dataset.contactCacheKey).toContain('room:2');
  expect(failedResource.dispose).toHaveBeenCalledOnce();
  view.unmount();
  expect(state.resource.dispose).toHaveBeenCalledOnce();
});

it('disposes a successful capture lifetime when a same-sized room replaces the effects store without unmounting', () => {
  registerCaster();
  const oldStore = state.store;
  const oldResource = state.resource;
  const view = render(<CachedContactShadows room={room} quality="standard" />);
  frame(1);
  frame(2);
  const receiver = state.receiver;
  expect(oldResource.capture).toHaveBeenCalledOnce();
  expect(state.material?.map).toBe(oldResource.texture);

  state.store = createSceneEffectsStore('room:2');
  registerCaster();
  state.resource = {
    texture: new Texture(),
    capture: vi.fn(),
    dispose: vi.fn(),
  };
  view.rerender(
    <CachedContactShadows
      room={{ ...room, roomId: 'next-room' }}
      quality="standard"
    />,
  );
  expect(state.receiver).toBe(receiver);
  expect(oldResource.dispose).toHaveBeenCalledOnce();
  expect(state.receiver?.visible).toBe(false);
  expect(state.material?.map).toBe(state.resource.texture);
  expect(canvas.dataset.contactCacheKey).toBeUndefined();
  frame(3);
  expect(state.resource.capture).not.toHaveBeenCalled();
  frame(4);
  expect(state.resource.capture).toHaveBeenCalledOnce();
  expect(state.receiver?.visible).toBe(true);
  const finishOldMotion = oldStore.beginCasterMotion('hover:old', 'red', true);
  expect(state.receiver?.visible).toBe(true);
  finishOldMotion();
  expect(oldResource.capture).toHaveBeenCalledOnce();
  view.unmount();
  expect(oldResource.dispose).toHaveBeenCalledOnce();
  expect(state.resource.dispose).toHaveBeenCalledOnce();
});
