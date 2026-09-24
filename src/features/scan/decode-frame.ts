import {
  BarcodeFormat,
  ChecksumException,
  FormatException,
  NotFoundException,
  Result,
} from '@zxing/library';
import jsQR from 'jsqr';

// Limit fallback work even when a phone offers a 4K camera stream. The normal
// ZXing pass still sees the original frame; only the QR fallback is resized.
const maxFallbackSide = 1920;
const maxFallbackPixels = 1920 * 1080;

function fallbackCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(
    1,
    maxFallbackSide / source.width,
    maxFallbackSide / source.height,
    Math.sqrt(maxFallbackPixels / (source.width * source.height)),
  );
  if (scale === 1) return source;
  const resized = document.createElement('canvas');
  resized.width = Math.max(1, Math.floor(source.width * scale));
  resized.height = Math.max(1, Math.floor(source.height * scale));
  resized
    .getContext('2d')
    ?.drawImage(source, 0, 0, resized.width, resized.height);
  return resized;
}

/** One camera-frame attempt: retain ZXing for QR/Code 128, then try jsQR for
 * ordinary decode misses. The caller owns the existing scan interval/controls.
 */
export function decodeInventoryFrame(
  canvas: HTMLCanvasElement,
  decodePrimary: () => Result,
): Result {
  try {
    return decodePrimary();
  } catch (primaryError) {
    if (
      !(primaryError instanceof NotFoundException) &&
      !(primaryError instanceof ChecksumException) &&
      !(primaryError instanceof FormatException)
    )
      throw primaryError;

    try {
      const frame = fallbackCanvas(canvas);
      const pixels = frame
        .getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, frame.width, frame.height);
      if (pixels) {
        const qr = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: 'dontInvert',
        });
        if (qr)
          return new Result(
            qr.data,
            new Uint8Array(qr.binaryData),
            qr.binaryData.length * 8,
            [],
            BarcodeFormat.QR_CODE,
          );
      }
    } catch {
      // A failed canvas read or QR fallback is an ordinary scan miss. Keep the
      // original retryable ZXing error so camera scanning/manual entry survive.
    }
    throw primaryError;
  }
}
