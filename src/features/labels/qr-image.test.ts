// @vitest-environment node
import { expect, it } from 'vitest';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import {
  BinaryBitmap,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { assetLabelPath, locationLabelPath } from '@/features/scan/targets';

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
  const gray = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < gray.length; i++) gray[i] = png.data[i * 4];
  const image = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(gray, png.width, png.height)),
  );
  expect(new MultiFormatReader().decode(image, new Map()).getText()).toBe(url);
});
