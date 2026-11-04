import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act as domAct, render } from '@testing-library/react';
import {
  act,
  createRoot,
  type RootState,
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
import type { Page } from '@playwright/test';
import type { RoomDefinition, RoomNode } from '../schema';
import { loadItCloset } from '../load';
import { buildRoomBindings } from '../bindings';
import { visibleRoomHit } from './visible-hover';
import { roomCanvasEvents } from './canvas-events';
import {
  captureRoomWitness,
  captureRoomSelectionWitness,
  roomWitnessCodeAtPoint,
} from '../../../../tests/e2e/room-visibility-witness';
import capturedTopTap from '../../../../tests/fixtures/room-top-tap.json';
import { attachMapInput } from './map-input';
import { roomSelectionTarget } from './room-selection';
import RoomScene, { type RoomSceneProps } from './room-scene';

type Trace = {
  recipient: number;
  action: string;
  owner?: string | null;
  accepted?: boolean;
  allowed?: boolean;
};
const observed = vi.hoisted(() => ({
  children: null as ReactNode,
  traces: [] as Trace[],
  next: 0,
  recording: false,
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
    <meshBasicMaterial transparent={opacity < 1} opacity={opacity} />
  ),
}));
vi.mock('./scene-palette', async (original) => ({
  ...(await original<typeof import('./scene-palette')>()),
  SelectionEdges: () => null,
}));
vi.mock('./room-selection', async (original) => {
  const actual = await original<typeof import('./room-selection')>();
  const record = (entry: Trace) => {
    if (!observed.recording) return;
    if (observed.traces.length >= 512)
      throw new Error('Gesture trace overflow');
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
          record({
            recipient,
            action: 'click',
            owner: code,
            accepted,
            allowed,
          });
          return accepted;
        },
        cancel() {
          record({ recipient, action: 'cancel' });
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
  MeshStandardMaterial: THREE.MeshStandardMaterial,
});
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  observed.traces = [];
  observed.next = 0;
  observed.recording = false;
  delete window.__roomWitnessStores;
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
type Replay = {
  geometry: {
    projection: number[];
    view: number[];
    frame: number[];
    point: number[];
  };
  nativeOffsets: { down: number[]; click: number[] };
};
async function fixture(
  nodes = [decoration, red],
  allowed = true,
  replay?: { room: RoomDefinition; input: Replay },
) {
  const select = vi.fn();
  const props = {
    room: replay?.room ?? { nodes, rackFaceProfiles: [] },
    bindings: replay ? buildRoomBindings(replay.room) : [],
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
  const envelopes: ReactElement<Record<string, unknown>>[] = [];
  const visit = (children: ReactNode) =>
    Children.forEach(children, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      if (child.props.node) visuals.push(child);
      else if (
        replay &&
        child.props.room === replay.room &&
        child.props.canRecenter
      )
        envelopes.push(child);
      else visit(child.props.children as ReactNode);
    });
  visit(observed.children);
  expect(visuals).toHaveLength(nodes.length);
  if (replay) expect(envelopes).toHaveLength(1);
  host.unmount();
  const eventHost = document.createElement('div');
  eventHost.dataset.roomSurface = '';
  const canvas = document.createElement('canvas');
  eventHost.append(canvas);
  document.body.append(eventHost);
  const frame = replay?.input.geometry.frame ?? [30, 149, 330, 408];
  const [left, top, width, height] = frame;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
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
  const derivedWorld = replay
    ? new THREE.Matrix4().fromArray(replay.input.geometry.view).invert()
    : null;
  if (replay && derivedWorld) {
    camera.near = 0.1;
    camera.far = 3000;
    camera.matrixAutoUpdate = false;
    camera.matrix.copy(derivedWorld);
    camera.matrixWorld.copy(derivedWorld);
    derivedWorld.decompose(camera.position, camera.quaternion, camera.scale);
    camera.projectionMatrix.fromArray(replay.input.geometry.projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    Object.assign(camera, { manual: true });
    camera.updateMatrixWorld(true);
  }
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
  let publicState!: RootState;
  const routing: {
    type: string;
    pointer: number[];
    owner: string | null;
    physical: string | null;
    recipients: (string | null)[];
  }[] = [];
  let nativeType = '';
  const eventFactory: typeof roomCanvasEvents = (store) => {
    const manager = roomCanvasEvents(store);
    const compute = manager.compute!;
    return {
      ...manager,
      compute(event, state, previous) {
        compute(event, state, previous);
        nativeType = event.type;
        if (!replay || !observed.recording) return;
        const hits = state.raycaster.camera
          ? state.raycaster.intersectObjects(state.scene.children, true)
          : [];
        routing.push({
          type: event.type,
          pointer: state.pointer.toArray(),
          owner: roomSelectionTarget(hits)?.code ?? null,
          physical: visibleRoomHit(hits)?.target?.code ?? null,
          recipients: [],
        });
      },
      filter(hits, state) {
        const result = manager.filter ? manager.filter(hits, state) : hits;
        if (replay && observed.recording) {
          const trace = routing.at(-1);
          if (trace && trace.type === nativeType)
            trace.recipients = [
              ...new Set(
                result.map((hit) => {
                  for (
                    let object: THREE.Object3D | null = hit.object;
                    object;
                    object = object.parent
                  ) {
                    const target = object.userData.roomHoverTarget as
                      { code: string } | undefined;
                    if (target) return target.code;
                  }
                  return null;
                }),
              ),
            ];
        }
        return result;
      },
    };
  };
  await root.configure({
    gl: () => renderer,
    camera,
    events: eventFactory,
    frameloop: 'never',
    dpr: 1,
    size: { width, height, top, left },
    onCreated: (state) => {
      scene = state.scene;
      publicState = state;
      state.events.connect?.(eventHost);
    },
  });
  const movement = { current: { suppressSelection: false } };
  const detach = attachMapInput(canvas, false, movement);
  // Read scene through the public Fiber onCreated callback/store, never __r3f.
  await act(async () => {
    root.render(
      <>
        {envelopes}
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
  expect(publicState.get().events.connected).toBe(eventHost);
  observed.traces = [];
  observed.recording = true;
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
    eventHost.remove();
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
  const sendExact = (
    type: string,
    offset: number[],
    target: HTMLElement = canvas,
  ) =>
    domAct(() => {
      const [clientX, clientY] = replay!.input.geometry.point;
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
      for (const [key, value] of Object.entries({
        pointerId: 7,
        pointerType: 'touch',
        offsetX: offset[0],
        offsetY: offset[1],
      }))
        Object.defineProperty(event, key, { value, enumerable: true });
      target.dispatchEvent(event);
    });
  return {
    select,
    send,
    owner,
    scene,
    camera,
    canvas,
    eventHost,
    publicState,
    routing,
    derivedWorld,
    sendExact,
    movement,
  };
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
      [
        {
          recipient: 1,
          action: 'click',
          owner: 'ITC-RED',
          accepted: true,
          allowed: true,
        },
      ],
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

// The hosted receipt captured down and click offsets, but did not capture up.
// Replay both observed offset variants as explicit assumptions, never as a
// claim about actual native pointerup coordinates. All events retain the exact
// observed client point; no point search or geometry changes are permitted.
const upAssumptions = [
  {
    name: 'up uses observed down offsets (assumption)',
    offset: capturedTopTap.nativeOffsets.down,
  },
  {
    name: 'up uses observed click offsets (assumption)',
    offset: capturedTopTap.nativeOffsets.click,
  },
];
async function canonicalCapturedFixture() {
  const room = loadItCloset();
  const input: Replay = capturedTopTap;
  const result = await fixture(room.nodes, true, { room, input });
  const { camera, scene, publicState, derivedWorld } = result;
  expect(derivedWorld).not.toBeNull();
  expect(camera.projectionMatrix.toArray()).toEqual(input.geometry.projection);
  expect(camera.matrixWorld.toArray()).toEqual(derivedWorld!.toArray());
  const viewRoundtripDelta = camera.matrixWorldInverse
    .toArray()
    .map((value, index) => value - input.geometry.view[index]);
  expect(viewRoundtripDelta.every(Number.isFinite)).toBe(true);
  window.__roomWitnessStores = new Set([{ getState: () => publicState.get() }]);
  const page = {
    evaluate: async (
      callback: (argument: unknown) => unknown,
      argument: unknown,
    ) => callback(argument),
  } as unknown as Page;
  const physical = await captureRoomWitness(page);
  const selection = await captureRoomSelectionWitness(page);
  const [x, y, width, height] = input.geometry.frame;
  const point = { x: input.geometry.point[0], y: input.geometry.point[1] };
  const rounded = {
    x: x + Math.round(point.x - x),
    y: y + Math.round(point.y - y),
  };
  expect(physical.frame).toEqual({ x, y, width, height });
  expect(selection.frame).toEqual(physical.frame);
  // Reuse the independent triangle algorithm with both observed and derived
  // camera matrices. Numeric inverse roundtrip deltas need no arbitrary epsilon:
  // the causal precondition is identical physical/selection ownership at BOTH
  // the captured client point and the originally qualified rounded witness.
  for (const snapshot of [physical, selection])
    for (const matrices of [
      snapshot,
      {
        ...snapshot,
        view: input.geometry.view,
        projection: input.geometry.projection,
      },
    ])
      for (const target of [point, rounded])
        expect(
          roomWitnessCodeAtPoint(matrices, target),
          'semantic camera/triangle replay parity',
        ).toBe('ITC-RED');
  const primary = room.nodes.find(
    (node) =>
      node.locationCode === 'ITC-RED' && node.interaction?.primaryBinding,
  );
  expect(primary).toBeDefined();
  const bodyGroups: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.userData.roomHoverVisualNode === primary!.id)
      bodyGroups.push(object);
  });
  expect(bodyGroups).toHaveLength(1);
  const expectedWorld = new THREE.Matrix4().makeTranslation(
    primary!.position[0],
    primary!.position[2],
    -primary!.position[1],
  );
  expect(
    bodyGroups[0].matrixWorld.toArray(),
    'canonical closed RED world transform',
  ).toEqual(expectedWorld.toArray());
  const body = bodyGroups[0].children[0] as THREE.Mesh<THREE.BoxGeometry>;
  expect(body.isMesh).toBe(true);
  expect(body.geometry.parameters).toMatchObject({
    width: primary!.size![0],
    height: primary!.size![2],
    depth: primary!.size![1],
  });
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((point.x - x) / width) * 2 - 1,
      1 - ((point.y - y) / height) * 2,
    ),
    camera,
  );
  const intersections = ray.intersectObjects(scene.children, true);
  expect(
    visibleRoomHit(intersections)?.target?.code,
    'actual closed physical RED at captured client point',
  ).toBe('ITC-RED');
  expect(
    roomSelectionTarget(intersections)?.code,
    'actual selection RED at captured client point',
  ).toBe('ITC-RED');
  observed.traces = [];
  result.routing.length = 0;
  return { ...result, input, viewRoundtripDelta };
}
it.each(upAssumptions)(
  'selects canonical closed RED through host-connected real Fiber at exact captured phone geometry: $name',
  async ({ name, offset }) => {
    const { select, sendExact, input, routing, movement, viewRoundtripDelta } =
      await canonicalCapturedFixture();
    sendExact('pointerdown', input.nativeOffsets.down);
    sendExact('pointerup', offset);
    sendExact('lostpointercapture', offset);
    sendExact('click', input.nativeOffsets.click);
    expect(movement.current.suppressSelection).toBe(false);
    expect(
      select,
      JSON.stringify({
        upOffsetAssumption: name,
        actualUpOffsetRecorded: false,
        viewRoundtripDelta,
        routing,
        gestures: observed.traces,
      }),
    ).toHaveBeenCalledExactlyOnceWith('ITC-RED');
  },
);

it.each(['button', 'label'] as const)(
  'keeps host-connected HTML %s input on its DOM action without a room pick underneath',
  async (kind) => {
    const { select, sendExact, input, eventHost, routing } =
      await canonicalCapturedFixture();
    const overlay = document.createElement(
      kind === 'button' ? 'button' : 'span',
    );
    if (kind === 'label') overlay.dataset.roomLabelCode = 'ITC-RED';
    eventHost.append(overlay);
    const domAction = vi.fn();
    overlay.addEventListener('click', domAction);
    sendExact('pointerdown', input.nativeOffsets.down, overlay);
    sendExact('pointerup', input.nativeOffsets.down, overlay);
    sendExact('click', input.nativeOffsets.click, overlay);
    expect(domAction).toHaveBeenCalledOnce();
    expect(select, JSON.stringify(observed.traces)).not.toHaveBeenCalled();
    expect(routing).toHaveLength(3);
    for (const trace of routing) {
      expect(trace.owner).toBeNull();
      expect(trace.physical).toBeNull();
      expect(trace.recipients).toEqual([]);
    }
    // A control cannot seed initialHits for a later canvas release/click.
    sendExact('pointerup', input.nativeOffsets.down);
    sendExact('click', input.nativeOffsets.click);
    expect(select).not.toHaveBeenCalled();
    // Fresh direct canvas input remains usable after the DOM action.
    sendExact('pointerdown', input.nativeOffsets.down);
    sendExact('pointerup', input.nativeOffsets.down);
    sendExact('click', input.nativeOffsets.click);
    expect(
      select,
      JSON.stringify(observed.traces),
    ).toHaveBeenCalledExactlyOnceWith('ITC-RED');
  },
);
