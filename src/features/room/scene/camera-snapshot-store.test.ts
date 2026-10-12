import { expect, it, vi } from 'vitest';
import {
  cameraAuthorityKey,
  createRoomCameraStore,
  type CameraAuthority,
} from './camera-snapshot-store';
import type { CameraView } from './camera-view';

const authority: CameraAuthority = {
  actorId: 'actor',
  backend: 'https://backend.example',
  generation: 'verified',
  revision: 1,
  epoch: 2,
};
const pose: CameraView = {
  position: [1, 2, 3],
  target: [0, 0, 0],
  zoom: 3.197955622141161,
  mode: 'free',
};
const descriptor = () => Object.freeze({});

it('retains a cloned numeric pose after workspace owner retirement, while rejecting its cleanup write', () => {
  const store = createRoomCameraStore(() => true);
  store.authorize(authority, true, false);
  const first = descriptor();
  const retire = store.bind(first, 'geometry', cameraAuthorityKey(authority));
  const input = {
    ...pose,
    position: [...pose.position] as CameraView['position'],
    inventoryName: 'never retain',
  };
  expect(store.write(first, input)).toBe(true);
  input.position[0] = 999;
  retire();
  expect(store.write(first, { ...pose, zoom: 1 })).toBe(false);
  expect(store.snapshot('geometry').view).toEqual(pose);
  expect(store.snapshot('geometry').view).not.toHaveProperty('inventoryName');
  expect(Object.isFrozen(store.snapshot('geometry').view?.position)).toBe(true);
  const remounted = descriptor();
  store.bind(remounted, 'geometry', cameraAuthorityKey(authority));
  expect(store.write(remounted, { ...pose, zoom: 4 })).toBe(true);
});

it.each(['actorId', 'backend', 'generation', 'revision', 'epoch'] as const)(
  'clears snapshots and stale callbacks after %s drift',
  (field) => {
    const store = createRoomCameraStore(() => true);
    store.authorize(authority, true, false);
    const old = descriptor();
    store.bind(old, 'geometry', cameraAuthorityKey(authority));
    store.write(old, pose);
    const next = {
      ...authority,
      [field]:
        typeof authority[field] === 'number'
          ? (authority[field] as number) + 1
          : authority[field] + '-changed',
    } as CameraAuthority;
    store.authorize(next, true, false);
    expect(store.snapshot('geometry').view).toBeNull();
    expect(store.write(old, pose)).toBe(false);
  },
);

it('preserves stored data during a visible ordinary recheck but retires old write grants on reauthorization', () => {
  const store = createRoomCameraStore(() => true);
  store.authorize(authority, true, false);
  const old = descriptor();
  store.bind(old, 'geometry', cameraAuthorityKey(authority));
  store.write(old, pose);
  store.authorize(authority, false, true);
  expect(store.snapshot('geometry').view).toEqual(pose);
  expect(store.snapshot('geometry').writable).toBe(false);
  expect(store.write(old, pose)).toBe(false);
  store.authorize(authority, true, false);
  store.bind(old, 'geometry', cameraAuthorityKey(authority));
  expect(store.write(old, pose)).toBe(false);
  expect(store.snapshot('geometry').view).toEqual(pose);
});

it('publishes only the changed key, caps snapshots at eight and separates changed geometry keys', () => {
  const store = createRoomCameraStore(() => true);
  store.authorize(authority, true, false);
  const unrelated = vi.fn(),
    layout = vi.fn(),
    current = vi.fn();
  store.subscribe('different-geometry', unrelated);
  store.subscribe('', layout);
  store.subscribe('geometry-0', current);
  for (let index = 0; index < 9; index++) {
    const owner = descriptor();
    store.bind(owner, 'geometry-' + index, cameraAuthorityKey(authority));
    store.write(owner, { ...pose, zoom: index + 1 });
  }
  expect(store.snapshot('geometry-0').view).toBeNull();
  expect(store.snapshot('geometry-8').view?.zoom).toBe(9);
  expect(store.snapshot('different-geometry').view).toBeNull();
  expect(unrelated).not.toHaveBeenCalled();
  expect(layout).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledTimes(2);
});

it('rejects malformed poses and expires all owners on revocation or provider disposal', () => {
  let valid = true;
  const store = createRoomCameraStore(() => valid);
  store.authorize(authority, true, false);
  const owner = descriptor();
  store.bind(owner, 'geometry', cameraAuthorityKey(authority));
  for (const invalid of [
    { ...pose, zoom: NaN },
    { ...pose, target: [NaN, 0, 0] },
    { ...pose, position: null },
  ])
    expect(store.write(owner, invalid as CameraView)).toBe(false);
  store.write(owner, pose);
  valid = false;
  expect(store.write(owner, pose)).toBe(false);
  store.retire();
  expect(store.snapshot('geometry').view).toBeNull();
  valid = true;
  store.authorize(authority, true, false);
  store.dispose();
  store.authorize(authority, true, false);
  expect(store.snapshot('geometry').authority).toBeNull();
  expect(store.write(owner, pose)).toBe(false);
});
