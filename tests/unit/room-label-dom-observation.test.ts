import { afterEach, expect, it, vi } from 'vitest';
import {
  installRoomLabelDomObservation,
  readRoomLabelSettleState,
} from '../e2e/room-label-dom-observation';
let stop: (() => void) | undefined;
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, '__readRoomDemandSnapshot');
  document.body.replaceChildren();
  Reflect.deleteProperty(window, '__readRoomLabelDomSnapshot');
});
it('distinguishes same-element registration metadata writes from new tooltip, anchored and marker DOM identities', async () => {
  stop = installRoomLabelDomObservation();
  const anchor = document.createElement('button');
  anchor.dataset.roomLabelCode = 'private-name-must-not-leave';
  anchor.textContent = 'private inventory name';
  document.body.append(anchor);
  anchor.dataset.labelLayoutId = 'private-id-must-not-leave';
  await tick();
  anchor.dataset.labelLayoutId = 'private-id-must-not-leave';
  await tick();
  const tooltip = document.createElement('button');
  tooltip.dataset.labelLayoutId = 'hover-tooltip';
  const marker = document.createElement('span');
  marker.dataset.roomOccupiedMarker = 'true';
  marker.dataset.labelLayoutId = 'private-marker-id';
  document.body.append(tooltip, marker);
  await tick();
  const first = window.__readRoomLabelDomSnapshot!();
  expect(first.kinds['anchored-action']).toEqual({
    newElements: 1,
    attributeWrites: 2,
    removals: 0,
  });
  expect(first.kinds.tooltip.newElements).toBe(1);
  expect(first.kinds['occupied-marker'].newElements).toBe(1);
  expect(first.kinds.tooltip.attributeWrites).toBe(0); // Detached writes cannot prove a call.
  const identity = first.recent.find(
    (entry) => entry.kind === 'tooltip',
  )!.serial;
  tooltip.remove();
  await tick();
  document.body.append(tooltip);
  await tick();
  const last = window.__readRoomLabelDomSnapshot!();
  expect(last.kinds.tooltip).toEqual({
    newElements: 1,
    attributeWrites: 0,
    removals: 1,
  });
  expect(last.recent.at(-1)).toMatchObject({
    kind: 'tooltip',
    serial: identity,
  });
  expect(JSON.stringify(last)).not.toMatch(/private|inventory/);
  expect(last.recent.length).toBeLessThanOrEqual(12);
});

it('keeps the exact readiness read and single-frame cadence when both diagnostic readers throw', async () => {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.dataset, {
    labelLayoutPending: 'false',
    labelLayoutRevision: '7',
    cameraViewMatrix: '[1,0,0,1]',
    cameraProjectionMatrix: '[1,0,0,1]',
    labelLayoutStatus: 'complete',
    spatialPhase: 'settled',
    sceneEffectFrames: '12',
    composerFrames: '10',
  });
  const frame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('requestAnimationFrame', frame);
  const baseline = await readRoomLabelSettleState(canvas);
  for (const key of ['__readRoomLabelDomSnapshot', '__readRoomDemandSnapshot'])
    Object.defineProperty(window, key, {
      configurable: true,
      get() {
        throw Error('Diagnostic blocked');
      },
    });
  const blocked = await readRoomLabelSettleState(canvas);
  expect(blocked).toEqual(baseline);
  expect(blocked).toMatchObject({
    current: { pending: 'false', revision: 7 },
    status: 'complete',
    phase: 'settled',
    demand: null,
    labelDom: null,
  });
  expect(frame).toHaveBeenCalledTimes(2); // Exactly the original one RAF per read.
});
it.each(['records', 'added', 'removed', 'deep'] as const)(
  'caps actual callback/traversal work and disconnects on oversized %s input',
  (variant) => {
    let callback!: MutationCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(value: MutationCallback) {
          callback = value;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    stop = installRoomLabelDomObservation();
    const root = document.createElement('div');
    const element = document.createElement('button');
    element.dataset.labelLayoutId = 'hover-tooltip';
    let records: MutationRecord[];
    if (variant === 'records') {
      records = Array.from(
        { length: 1000 },
        () =>
          ({
            type: 'attributes',
            target: element,
          }) as unknown as MutationRecord,
      );
    } else {
      let parent: Element = root;
      for (let index = 0; index < 1000; index++) {
        const child = document.createElement('span');
        child.dataset.labelLayoutId = 'private-unlogged-id';
        parent.append(child);
        if (variant === 'deep') parent = child;
      }
      records = [
        {
          type: 'childList',
          addedNodes: variant === 'removed' ? [] : [root],
          removedNodes: variant === 'removed' ? [root] : [],
        } as unknown as MutationRecord,
      ];
    }
    const reads = vi.spyOn(Element.prototype, 'getAttribute');
    const lists = vi.spyOn(Element.prototype, 'querySelectorAll');
    callback(records, {} as MutationObserver);
    const snapshot = window.__readRoomLabelDomSnapshot!();
    expect(snapshot.overflow).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(lists).not.toHaveBeenCalled();
    expect(reads.mock.calls.length).toBeLessThanOrEqual(256);
    expect(snapshot.recent.length).toBeLessThanOrEqual(12);
    const before = reads.mock.calls.length;
    callback(records, {} as MutationObserver); // Already queued deliveries do no work.
    expect(reads).toHaveBeenCalledTimes(before);
    expect(window.__readRoomLabelDomSnapshot!()).toEqual(snapshot);
  },
);
