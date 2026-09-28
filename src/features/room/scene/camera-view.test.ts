import { expect, it } from 'vitest';
import { loadItCloset } from '../load';
import { cameraViewKey, validCameraView } from './camera-view';

it('keeps a camera snapshot within the same user, environment, space and geometry', () => {
  const room = loadItCloset();
  const key = cameraViewKey(
    'user-a',
    'https://preview-a.example',
    'it-closet',
    room,
  );
  expect(
    cameraViewKey('user-a', 'https://preview-a.example', 'it-closet', room),
  ).toBe(key);
  expect(
    cameraViewKey('user-b', 'https://preview-a.example', 'it-closet', room),
  ).not.toBe(key);
  expect(
    cameraViewKey('user-a', 'https://preview-b.example', 'it-closet', room),
  ).not.toBe(key);
  expect(
    cameraViewKey('user-a', 'https://preview-a.example', 'other-room', room),
  ).not.toBe(key);
  expect(
    cameraViewKey('user-a', 'https://preview-a.example', 'it-closet', {
      ...room,
      dimensions: [
        room.dimensions[0] + 1,
        room.dimensions[1],
        room.dimensions[2],
      ],
    }),
  ).not.toBe(key);
});
it('rejects nonfinite or collapsed camera snapshots', () => {
  expect(
    validCameraView({
      position: [10, 20, 30],
      target: [0, 0, 0],
      zoom: 1,
      mode: 'free',
    }),
  ).toBe(true);
  expect(
    validCameraView({
      position: [0, 0, 0],
      target: [0, 0, 0],
      zoom: 1,
      mode: 'free',
    }),
  ).toBe(false);
  expect(
    validCameraView({
      position: [10, 20, Infinity],
      target: [0, 0, 0],
      zoom: 1,
      mode: 'guided',
    }),
  ).toBe(false);
});
