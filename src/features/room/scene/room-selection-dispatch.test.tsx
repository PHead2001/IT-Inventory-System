import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act as domAct, render } from '@testing-library/react';
import {
  act,
  createRoot,
  events,
  extend,
  unmountComponentAtNode,
} from '@react-three/fiber';
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import type { RoomNode } from '../schema';
import { attachMapInput } from './map-input';
import { roomSelectionTarget } from './room-selection';
import RoomScene, { type RoomSceneProps } from './room-scene';

type Trace = {
  recipient: number;
  action: string;
  owner?: string | null;
  accepted?: boolean;
};
const observed = vi.hoisted(() => ({
  children: null as ReactNode,
  traces: [] as Trace[],
  next: 0,
}));
vi.mock('./safe-canvas', () => ({
  SafeCanvas: ({ children }: { children: ReactNode }) => {
    observed.children = children;
    return <canvas />;
  },
}));
// Only replace GPU presentation. NodeVisual, gesture policy, Three raycasts and
// the pinned Fiber reconciler/event manager all run their real implementations.
vi.mock('./selection-material', () => ({
  SelectionMaterial: ({ opacity = 1 }: { opacity?: number }) => (
    <meshBasicMaterial opacity={opacity} />
  ),
}));
vi.mock('./scene-palette', async (original) => ({
  ...(await original<typeof import('./scene-palette')>()),
  SelectionEdges: () => null,
}));
vi.mock('./room-selection', async (original) => {
  const actual = await original<typeof import('./room-selection')>();
  const record = (entry: Trace) => {
    if (observed.traces.length >= 64) throw new Error('Gesture trace overflow');
    observed.traces.push(entry);
  };
  return {
    ...actual,
    createRoomSelectionGesture: () => {
      const gesture = actual.createRoomSelectionGesture();
      const recipient = observed.next++;
      return {
        down(code: string | null, pointer: number) {
          record({ recipient, action: 'down', owner: code });
          gesture.down(code, pointer);
        },
        up(code: string | null, pointer: number) {
          record({ recipient, action: 'up', owner: code });
          gesture.up(code, pointer);
        },
        click(code: string | null, delta: number, allowed: boolean) {
          const accepted = gesture.click(code, delta, allowed);
          record({ recipient, action: 'click', owner: code, accepted });
          return accepted;
        },
        cancel() {
          gesture.cancel();
        },
      };
    },
  };
});

extend({
  Group: THREE.Group,
  Mesh: THREE.Mesh,
  BoxGeometry: THREE.BoxGeometry,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
});
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  observed.traces = [];
  observed.next = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const red: RoomNode = {
  id: 'red',
  kind: 'box',
  locationCode: 'ITC-RED',
  position: [0, 0, 0],
  rotationZDegrees: 0,
  size: [10, 10, 2],
  interaction: {
    selectable: true,
    primaryBinding: true,
    label: 'Red container',
    focusPoint: [0, 0, 0],
  },
};
const decoration: RoomNode = {
  id: 'pass-through',
  kind: 'box',
  position: [0, 0, 3],
  rotationZDegrees: 0,
  size: [8, 8, 0.1],
  visual: { color: '#000000', opacity: 0, edges: false },
};
const tiedProxy: RoomNode = {
  id: 'foreign-proxy',
  kind: 'box',
  locationCode: 'ITC-OTHER',
  position: [0, 0, -5],
  rotationZDegrees: 0,
  size: [1, 1, 1],
  interaction: {
    selectable: true,
    primaryBinding: true,
    label: 'Other container',
    focusPoint: [0, 0, 0],
    hitBox: { center: [0, 0, 5], size: [10, 10, 2] },
  },
};
async function fixture(nodes = [decoration, red], allowed = true) {
  const select = vi.fn();
  const props = {
    room: { nodes, rackFaceProfiles: [] },
    bindings: [],
    selectedCode: null,
    highlightedCodes: [],
    focusRequest: { code: null, requestId: 0 },
    onSelect: select,
    onReady: vi.fn(),
    onFocusComplete: vi.fn(),
    onFailure: vi.fn(),
    canFocusSelected: false,
    onRequestFocus: vi.fn(),
  } as unknown as RoomSceneProps;
  const host = render(<RoomScene {...props} />);
  const visuals: ReactElement<Record<string, unknown>>[] = [];
  const visit = (children: ReactNode) =>
    Children.forEach(children, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      if (child.props.node) visuals.push(child);
      else visit(child.props.children as ReactNode);
    });
  visit(observed.children);
  expect(visuals).toHaveLength(nodes.length);
  host.unmount();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 30,
    top: 149,
    right: 360,
    bottom: 557,
    width: 330,
    height: 408,
    x: 30,
    y: 149,
    toJSON: () => ({}),
  });
  const camera = new THREE.OrthographicCamera(
    -10,
    10,
    408 / 33,
    -408 / 33,
    0.1,
    100,
  );
  camera.position.set(0, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const renderer = {
    domElement: canvas,
    render: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    getPixelRatio: () => 1,
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAnimationLoop: vi.fn(),
    },
    shadowMap: {},
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
  const root = createRoot(canvas);
  let scene!: THREE.Scene;
  await root.configure({
    gl: () => renderer,
    camera,
    events,
    frameloop: 'never',
    dpr: 1,
    size: { width: 330, height: 408, top: 149, left: 30 },
    onCreated: (state) => {
      scene = state.scene;
    },
  });
  const movement = { current: { suppressSelection: false } };
  const detach = attachMapInput(canvas, false, movement);
  // Read scene through the public Fiber onCreated callback/store, never __r3f.
  await act(async () => {
    root.render(
      <>
        {visuals.map((visual, i) =>
          cloneElement(visual, {
            key: i,
            onSelect: select,
            canSelect: () => allowed && !movement.current.suppressSelection,
          }),
        )}
      </>,
    );
  });
  scene.updateMatrixWorld(true);
  cleanups.push(async () => {
    detach();
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await act(async () => {
      unmountComponentAtNode(canvas, complete);
    });
    await completed;
    expect(renderer.dispose).toHaveBeenCalledExactlyOnceWith();
    expect(renderer.forceContextLoss).toHaveBeenCalledExactlyOnceWith();
    expect(renderer.xr.removeEventListener).toHaveBeenCalledTimes(2);
    canvas.remove();
  });
  const send = (type: string, x = 195, pointerId = 7) =>
    domAct(() => {
      const event = new MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: 353,
      });
      for (const [key, value] of Object.entries({
        pointerId,
        pointerType: 'touch',
        offsetX: x - 30,
        offsetY: 204,
      }))
        Object.defineProperty(event, key, { value, enumerable: true });
      canvas.dispatchEvent(event);
    });
  const owner = () => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    return (
      roomSelectionTarget(ray.intersectObjects(scene.children, true))?.code ??
      null
    );
  };
  return { select, send, owner, scene };
}

it.each([
  ['transparent decoration', decoration],
  ['equal-depth foreign proxy', tiedProxy],
] as const)(
  'routes a top-view touch through %s to its authoritative owner',
  async (_name, nonowner) => {
    const { select, send, owner } = await fixture([nonowner, red]);
    expect(owner()).toBe('ITC-RED');
    send('pointerdown');
    send('pointerup');
    send('lostpointercapture');
    send('click');
    expect(
      select,
      JSON.stringify(observed.traces),
    ).toHaveBeenCalledExactlyOnceWith('ITC-RED');
    expect(observed.traces.filter((entry) => entry.action === 'down')).toEqual([
      { recipient: 1, action: 'down', owner: 'ITC-RED' },
    ]);
    expect(observed.traces.filter((entry) => entry.action === 'click')).toEqual(
      [{ recipient: 1, action: 'click', owner: 'ITC-RED', accepted: true }],
    );
  },
);
it('does not select through opaque unbound furniture', async () => {
  const { select, send, owner } = await fixture([
    { ...decoration, visual: undefined },
    red,
  ]);
  expect(owner()).toBeNull();
  send('pointerdown');
  send('pointerup');
  send('click');
  expect(select).not.toHaveBeenCalled();
});
it.each([
  'different-pointer',
  'different-owner',
  'drag',
  'lost-capture',
  'cancel',
  'denied',
] as const)('rejects %s through real Fiber dispatch', async (reason) => {
  const { select, send, scene } = await fixture(undefined, reason !== 'denied');
  send('pointerdown');
  if (reason === 'different-owner') {
    const blocker = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.1, 8),
      new THREE.MeshBasicMaterial(),
    );
    blocker.position.y = 5;
    scene.add(blocker);
    scene.updateMatrixWorld(true);
    send('pointerup');
    scene.remove(blocker);
  } else {
    if (reason === 'lost-capture') send('lostpointercapture');
    if (reason === 'cancel') send('pointercancel');
    if (reason === 'drag') send('pointermove', 201);
    send('pointerup', 195, reason === 'different-pointer' ? 8 : 7);
  }
  send('click');
  expect(select).not.toHaveBeenCalled();
  // A fresh matching gesture remains usable after a rejected attempt.
  if (reason !== 'denied') {
    send('pointerdown');
    send('pointerup');
    send('click');
    expect(select).toHaveBeenCalledExactlyOnceWith('ITC-RED');
  }
});
