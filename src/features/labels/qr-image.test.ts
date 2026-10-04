// @vitest-environment node
import { expect, it } from 'vitest';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  RGBLuminanceSource,
} from '@zxing/library';
import { assetLabelPath, locationLabelPath } from '@/features/scan/targets';
import { decodeInventoryFrame } from '@/features/scan/decode-frame';

function decodePrimary(png: PNG) {
  const gray = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < gray.length; i++) gray[i] = png.data[i * 4];
  const image = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(gray, png.width, png.height)),
  );
  return new MultiFormatReader().decode(
    image,
    new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]),
  );
}

function decodeGeneratedImage(png: PNG): string {
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
  return decodeInventoryFrame(canvas, () => decodePrimary(png)).getText();
}

it.each([
  locationLabelPath('ITC-S1A'),
  assetLabelPath('7b84a7cf-197b-45b1-8016-87482d124cb4'),
])('decodes a generated QR image for %s', async (path) => {
  const url = 'https://inventory.example.test' + path;
  const png = PNG.sync.read(
    await QRCode.toBuffer(url, {
      margin: 4,
      width: 320,
      errorCorrectionLevel: 'M',
    }),
  );
  expect(decodeGeneratedImage(png)).toBe(url);
});

it('decodes an actual generated local asset QR that the primary decoder misses', async () => {
  const url =
    'http://127.0.0.1:3000' +
    assetLabelPath('e0826584-7e48-497f-87c2-e804a5cc5f2b');
  const source = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  });
  const png = PNG.sync.read(Buffer.from(source.split(',')[1], 'base64'));
  expect(() => decodePrimary(png)).toThrow(NotFoundException);
  expect(decodeGeneratedImage(png)).toBe(url);
});
