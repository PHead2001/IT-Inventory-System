import { Result, BarcodeFormat } from '@zxing/library';
import { expect, it } from 'vitest';
import {
  projectDecoderGeometry,
  retainDecoderGeometry,
  readDecoderGeometry,
  type DecoderGeometry,
} from './decoder-geometry';
const source: DecoderGeometry = {
  width: 400,
  height: 200,
  points: [
    { x: 100, y: 50 },
    { x: 300, y: 150 },
  ],
  corners: false,
};
it('projects centered contain letterboxing and explicit mirroring without changing decoder landmarks', () => {
  expect(
    projectDecoderGeometry(source, {
      width: 200,
      height: 200,
      fit: 'contain',
      mirrored: false,
    }).points,
  ).toEqual([
    { x: 25, y: 37.5 },
    { x: 75, y: 62.5 },
  ]);
  expect(
    projectDecoderGeometry(source, {
      width: 200,
      height: 200,
      fit: 'contain',
      mirrored: true,
    }).points,
  ).toEqual([
    { x: 75, y: 37.5 },
    { x: 25, y: 62.5 },
  ]);
  expect(source.points[0]).toEqual({ x: 100, y: 50 });
});
it('projects centered cover crop, keeping offscreen points as offscreen rather than clamping invented bounds', () => {
  const result = projectDecoderGeometry(
    {
      ...source,
      points: [
        { x: 0, y: 0 },
        { x: 400, y: 200 },
      ],
    },
    { width: 200, height: 200, fit: 'cover', mirrored: false },
  );
  expect(result.points).toEqual([
    { x: -50, y: 0 },
    { x: 150, y: 100 },
  ]);
  expect(result.corners).toBe(false);
});
it.each([0, -1, NaN, Infinity])(
  'rejects missing or invalid intrinsic/viewport dimensions: %s',
  (width) => {
    expect(
      projectDecoderGeometry(
        { ...source, width },
        { width: 200, height: 200, fit: 'contain', mirrored: false },
      ).points,
    ).toEqual([]);
    expect(
      projectDecoderGeometry(source, {
        width,
        height: 200,
        fit: 'contain',
        mirrored: false,
      }).points,
    ).toEqual([]);
  },
);
it('rejects incomplete corrupt bounds instead of showing a misleading outline', () => {
  expect(
    projectDecoderGeometry(
      { ...source, corners: true, points: [{ x: -1, y: 30 }] },
      { width: 200, height: 200, fit: 'contain', mirrored: false },
    ),
  ).toMatchObject({ points: [], corners: false });
});

it('retains geometry by actual result identity rather than decoded text, with no synthesized outline', () => {
  const first = new Result(
      'same',
      new Uint8Array(),
      0,
      [],
      BarcodeFormat.QR_CODE,
    ),
    second = new Result('same', new Uint8Array(), 0, [], BarcodeFormat.QR_CODE);
  retainDecoderGeometry(first, source);
  retainDecoderGeometry(second, {
    ...source,
    points: [{ x: 1, y: 2 }],
    corners: false,
  });
  expect(readDecoderGeometry(first, {} as HTMLVideoElement).points).toEqual(
    source.points,
  );
  expect(readDecoderGeometry(second, {} as HTMLVideoElement).points).toEqual([
    { x: 1, y: 2 },
  ]);
  expect(readDecoderGeometry(second, {} as HTMLVideoElement).corners).toBe(
    false,
  );
});
