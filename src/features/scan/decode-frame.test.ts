import jsQR from 'jsqr';
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import {
  BarcodeFormat,
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  Result,
  RGBLuminanceSource,
} from '@zxing/library';
import { decodeInventoryFrame } from './decode-frame';
import { InventoryCodeReader } from './inventory-code-reader';
import { readDecoderGeometry } from './decoder-geometry';

const ciUrl =
  'http://127.0.0.1:3000/inventory/assets/9fee7834-40a4-4983-94a1-6eee3ecad3ee';
const longPreviewUrl =
  'https://it-inventory-system-git-fix-category-history-v-dec44d-phead2002.vercel.app/inventory/assets/a5b3f2be-1529-435e-a062-0e52c61f126e';

function frameFromPng(bytes: Buffer) {
  const png = PNG.sync.read(bytes);
  const rgba = new Uint8ClampedArray(png.data);
  const canvas = {
    width: png.width,
    height: png.height,
    getContext: () => ({
      getImageData: () => ({
        data: rgba,
        width: png.width,
        height: png.height,
      }),
    }),
  } as unknown as HTMLCanvasElement;
  const primary = () => {
    const gray = new Uint8ClampedArray(png.width * png.height);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
    return new MultiFormatReader().decode(
      new BinaryBitmap(
        new HybridBinarizer(
          new RGBLuminanceSource(gray, png.width, png.height),
        ),
      ),
      new Map(),
    );
  };
  return { canvas, primary };
}

afterEach(() => vi.unstubAllGlobals());

it('decodes the exact PR13 rendered QR screenshot missed by the primary reader', () => {
  const screenshot = readFileSync(
    fileURLToPath(
      new URL(
        '../../../tests/fixtures/qr/pr13-asset-label-zxing-miss.png',
        import.meta.url,
      ),
    ),
  );
  const { canvas, primary } = frameFromPng(screenshot);
  expect(primary).toThrow();
  const decoded = decodeInventoryFrame(canvas, primary);
  expect(decoded.getText()).toBe(ciUrl);
  expect(decoded.getBarcodeFormat()).toBe(BarcodeFormat.QR_CODE);
  const geometry = readDecoderGeometry(decoded, {} as HTMLVideoElement);
  expect(geometry).toMatchObject({
    width: canvas.width,
    height: canvas.height,
    corners: true,
  });
  expect(geometry.points).toHaveLength(4);
  expect(
    geometry.points.every(
      (point) =>
        point.x >= 0 &&
        point.x <= canvas.width &&
        point.y >= 0 &&
        point.y <= canvas.height,
    ),
  ).toBe(true);
  // This is the same override invoked by the camera scan loop.
  expect(new InventoryCodeReader().decodeFromCanvas(canvas).getText()).toBe(
    ciUrl,
  );
});

it.each([166, 227])(
  'decodes an M-encoded long-origin asset QR at %ipx without truncating its URL',
  async (width) => {
    const { canvas, primary } = frameFromPng(
      await QRCode.toBuffer(longPreviewUrl, {
        errorCorrectionLevel: 'M',
        margin: 4,
        width,
      }),
    );
    expect(decodeInventoryFrame(canvas, primary).getText()).toBe(
      longPreviewUrl,
    );
  },
);

it('preserves primary Code 128 results without reading frame pixels', () => {
  const code = new Result(
    'AST:ITC',
    new Uint8Array(),
    0,
    [],
    BarcodeFormat.CODE_128,
  );
  const canvas = {
    width: 100,
    height: 100,
    getContext: vi.fn(),
  } as unknown as HTMLCanvasElement;
  expect(decodeInventoryFrame(canvas, () => code)).toBe(code);
  expect(canvas.getContext).not.toHaveBeenCalled();
});

it('decodes an actual rendered Code 128 label through the production reader', () => {
  const screenshot = readFileSync(
    fileURLToPath(
      new URL(
        '../../../tests/fixtures/qr/location-code128-crop.png',
        import.meta.url,
      ),
    ),
  );
  const { canvas } = frameFromPng(screenshot);
  const decoded = new InventoryCodeReader().decodeFromCanvas(canvas);
  expect(decoded.getBarcodeFormat()).toBe(BarcodeFormat.CODE_128);
  expect(decoded.getText()).toBe('LOC:ITC');
  expect(readDecoderGeometry(decoded, {} as HTMLVideoElement)).toEqual({
    width: canvas.width,
    height: canvas.height,
    corners: false,
    points: decoded
      .getResultPoints()
      .map((point) => ({ x: point.getX(), y: point.getY() })),
  });
});

it('keeps the primary miss for noise and never invents a destination', () => {
  const miss = new NotFoundException();
  const png = new PNG({ width: 100, height: 100 });
  png.data.fill(255);
  const { canvas } = frameFromPng(PNG.sync.write(png));
  expect(() =>
    decodeInventoryFrame(canvas, () => {
      throw miss;
    }),
  ).toThrow(miss);
});

it('does not run fallback for non-decoder errors', () => {
  const fault = new Error('camera failed');
  const canvas = { getContext: vi.fn() } as unknown as HTMLCanvasElement;
  expect(() =>
    decodeInventoryFrame(canvas, () => {
      throw fault;
    }),
  ).toThrow(fault);
  expect(canvas.getContext).not.toHaveBeenCalled();
});

it('bounds fallback canvas dimensions for large camera frames', () => {
  const drawImage = vi.fn();
  const resized = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage,
      getImageData: () => {
        throw new Error('test stop');
      },
    }),
  };
  vi.stubGlobal('document', { createElement: () => resized });
  const miss = new NotFoundException();
  expect(() =>
    decodeInventoryFrame(
      { width: 3840, height: 2160 } as HTMLCanvasElement,
      () => {
        throw miss;
      },
    ),
  ).toThrow(miss);
  expect(resized.width * resized.height).toBeLessThanOrEqual(1920 * 1080);
  expect(Math.max(resized.width, resized.height)).toBeLessThanOrEqual(1920);
  expect(drawImage).toHaveBeenCalledOnce();
});

it('scales actual jsQR corners from a bounded fallback canvas back to the original frame', async () => {
  const png = PNG.sync.read(
    await QRCode.toBuffer(ciUrl, {
      width: 1440,
      margin: 4,
      errorCorrectionLevel: 'M',
    }),
  );
  const pixels = new Uint8ClampedArray(png.data);
  const actual = jsQR(pixels, png.width, png.height, {
    inversionAttempts: 'dontInvert',
  })!;
  const drawImage = vi.fn(),
    resized = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage,
        getImageData: () => ({ data: pixels, width: 1440, height: 1440 }),
      }),
    };
  vi.stubGlobal('document', { createElement: () => resized });
  const canvas = { width: 3840, height: 3840 } as HTMLCanvasElement;
  const decoded = decodeInventoryFrame(canvas, () => {
    throw new NotFoundException();
  });
  const geometry = readDecoderGeometry(decoded, {} as HTMLVideoElement);
  expect(decoded.getText()).toBe(ciUrl);
  expect(resized).toMatchObject({ width: 1440, height: 1440 });
  expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 1440, 1440);
  expect(geometry).toEqual({
    width: 3840,
    height: 3840,
    corners: true,
    points: [
      actual.location.topLeftCorner,
      actual.location.topRightCorner,
      actual.location.bottomRightCorner,
      actual.location.bottomLeftCorner,
    ].map((point) => ({
      x: (point.x * 3840) / 1440,
      y: (point.y * 3840) / 1440,
    })),
  });
});
