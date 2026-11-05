import type { Result } from '@zxing/library';

export type ScanPoint = { x: number; y: number };
export type DecoderGeometry = {
  width: number;
  height: number;
  points: ScanPoint[];
  // ZXing finder centers/endpoints are landmarks, never a full QR outline.
  corners: boolean;
};
const geometry = new WeakMap<Result, DecoderGeometry>();
export function retainDecoderGeometry(result: Result, value: DecoderGeometry) {
  geometry.set(result, value);
  return result;
}
export function readDecoderGeometry(result: Result, video: HTMLVideoElement) {
  return (
    geometry.get(result) ?? {
      width: video.videoWidth,
      height: video.videoHeight,
      points: (result.getResultPoints?.() ?? []).map((point) => ({
        x: point.getX(),
        y: point.getY(),
      })),
      corners: false,
    }
  );
}

/** Centered object-fit projection in percent of the actual preview box.
 * Mirroring is explicit and must match the video's presentation transform. */
export function projectDecoderGeometry(
  source: DecoderGeometry,
  box: {
    width: number;
    height: number;
    fit: 'contain' | 'cover';
    mirrored: boolean;
  },
): DecoderGeometry {
  const { width, height } = source;
  if (
    ![width, height, box.width, box.height].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return { ...source, points: [], corners: false };
  const scale = (box.fit === 'cover' ? Math.max : Math.min)(
    box.width / width,
    box.height / height,
  );
  const offsetX = (box.width - width * scale) / 2;
  const offsetY = (box.height - height * scale) / 2;
  // Reject incomplete/corrupt geometry rather than manufacturing a clipped outline.
  if (
    source.points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > width ||
        point.y < 0 ||
        point.y > height,
    )
  )
    return { ...source, points: [], corners: false };
  return {
    ...source,
    points: source.points.map((point) => {
      const x = ((offsetX + point.x * scale) / box.width) * 100;
      return {
        x: box.mirrored ? 100 - x : x,
        y: ((offsetY + point.y * scale) / box.height) * 100,
      };
    }),
  };
}
