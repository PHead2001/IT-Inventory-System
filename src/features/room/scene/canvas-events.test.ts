import { afterEach, expect, it, vi } from 'vitest';
import { events, type RootState, type RootStore } from '@react-three/fiber';
import { OrthographicCamera, Raycaster, Vector2 } from 'three';
import { roomCanvasEvents } from './canvas-events';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const canvas = document.createElement('canvas');
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 3000);
  camera.position.set(0, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const raycaster = new Raycaster();
  const state = {
    gl: { domElement: canvas },
    camera,
    raycaster,
    pointer: new Vector2(),
    size: { width: 330, height: 408 },
  } as RootState;
  const store = { getState: () => state } as RootStore;
  const rect = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 29.33333396911621,
    top: 345.71875,
    x: 29.33333396911621,
    y: 345.71875,
    width: 316,
    height: 408.66668701171875,
    right: 345.3333339691162,
    bottom: 754.3854370117188,
    toJSON: () => ({}),
  });
  const manager = roomCanvasEvents(store);
  const compute = (
    offset: number[],
    target: HTMLElement = canvas,
    client = [87, 597],
  ) => {
    const event = new MouseEvent('click');
    for (const [key, value] of Object.entries({
      target,
      clientX: client[0],
      clientY: client[1],
      offsetX: offset[0],
      offsetY: offset[1],
    }))
      Object.defineProperty(event, key, { value });
    manager.compute!(event, state);
  };
  return { canvas, camera, state, rect, manager, store, compute };
}

it('keeps the stock public event manager contract while replacing only compute', () => {
  const { manager, store } = fixture();
  const stock = events(store);
  expect(Object.keys(manager).sort()).toEqual(Object.keys(stock).sort());
  expect(manager.priority).toBe(stock.priority);
  expect(manager.enabled).toBe(stock.enabled);
  expect(Object.keys(manager.handlers!).sort()).toEqual(
    Object.keys(stock.handlers!).sort(),
  );
  for (const field of ['connect', 'disconnect', 'update'] as const)
    expect(typeof manager[field]).toBe('function');
});

it('uses exact client minus fractional live canvas origin for both recorded native offset variants', () => {
  const { state, rect, compute, camera } = fixture();
  for (const offset of [
    [57.66666793823242, 251.28125],
    [58, 252],
  ]) {
    rect.mockClear();
    compute(offset);
    expect(state.pointer.toArray()).toEqual([
      ((87 - 29.33333396911621) / 316) * 2 - 1,
      1 - ((597 - 345.71875) / 408.66668701171875) * 2,
    ]);
    expect(state.raycaster.camera).toBe(camera);
    expect(rect).toHaveBeenCalledOnce();
  }
});

it('reads a later live rect once without reusing state.size or a previous origin', () => {
  const { state, rect, compute } = fixture();
  compute([58, 252]);
  const next = {
    ...rect.mock.results[0].value,
    left: 40.125,
    top: 300.25,
    width: 290.5,
    height: 380.75,
  };
  rect.mockReturnValue(next).mockClear();
  compute([58, 252]);
  expect(state.pointer.toArray()).toEqual([
    ((87 - next.left) / next.width) * 2 - 1,
    1 - ((597 - next.top) / next.height) * 2,
  ]);
  expect(rect).toHaveBeenCalledOnce();
});

it.each(['button', 'label'] as const)(
  'does not compute a room ray for a host HTML %s target',
  (kind) => {
    const { state, rect, compute } = fixture();
    const overlay = document.createElement(
      kind === 'button' ? 'button' : 'span',
    );
    if (kind === 'label') overlay.dataset.roomLabelCode = 'ITC-RED';
    compute([58, 252]);
    const ray = vi.spyOn(state.raycaster, 'setFromCamera');
    rect.mockClear();
    compute([0, 0], overlay);
    expect(state.raycaster.camera).toBeNull();
    expect(ray).not.toHaveBeenCalled();
    expect(rect).not.toHaveBeenCalled();
  },
);

it.each([
  { width: 0 },
  { height: -1 },
  { width: NaN },
  { height: Infinity },
  { left: NaN },
  { top: Infinity },
])(
  'rejects invalid live frame %j without retaining a previous ray',
  (patch) => {
    const { state, rect, compute } = fixture();
    compute([58, 252]);
    const ray = vi.spyOn(state.raycaster, 'setFromCamera');
    const invalid = { ...rect.mock.results[0].value, ...patch };
    rect.mockReturnValue(invalid).mockClear();
    compute([58, 252]);
    expect(state.raycaster.camera).toBeNull();
    expect(ray).not.toHaveBeenCalled();
    expect(rect).toHaveBeenCalledOnce();
  },
);

it.each([{ client: [NaN, 597] }, { client: [87, Infinity] }])(
  'rejects nonfinite client input $client without a room ray',
  ({ client }) => {
    const { state, compute } = fixture();
    const ray = vi.spyOn(state.raycaster, 'setFromCamera');
    compute([58, 252], undefined, client);
    expect(state.raycaster.camera).toBeNull();
    expect(ray).not.toHaveBeenCalled();
  },
);
