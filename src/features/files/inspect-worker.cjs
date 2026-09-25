/* eslint-disable @typescript-eslint/no-require-imports */
const { parentPort } = require('node:worker_threads');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

parentPort.on('message', async ({ bytes, type }) => {
  try {
    const input = Buffer.from(bytes);
    if (input.length === 0 || input.length > 20971520)
      throw new Error('File exceeds 20 MiB.');
    if (
      input.subarray(4, 12).toString('ascii').startsWith('ftyphei') ||
      input.subarray(4, 12).toString('ascii').startsWith('ftypmif')
    )
      throw new Error('HEIC/HEIF is not supported. Convert it to JPEG or PNG.');
    if (type === 'application/pdf') {
      if (input.subarray(0, 5).toString('ascii') !== '%PDF-')
        throw new Error('Invalid PDF signature.');
      const document = await PDFDocument.load(input, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (
        document.isEncrypted ||
        document.getPageCount() < 1 ||
        document.getPageCount() > 250 ||
        document.context.enumerateIndirectObjects().length > 10000
      )
        throw new Error('Encrypted or overly complex PDF is not supported.');
      parentPort.postMessage({ ok: true, variants: [] });
      return;
    }
    const signatures = {
      'image/jpeg': input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff,
      'image/png': input
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/webp':
        input.subarray(0, 4).toString('ascii') === 'RIFF' &&
        input.subarray(8, 12).toString('ascii') === 'WEBP',
    };
    if (!signatures[type])
      throw new Error('The file content does not match its image type.');
    const image = sharp(input, {
      limitInputPixels: 25000000,
      animated: false,
      failOn: 'error',
    });
    const meta = await image.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > 25000000 ||
      (meta.pages ?? 1) !== 1 ||
      !['jpeg', 'png', 'webp'].includes(meta.format)
    )
      throw new Error('Unsupported image or image exceeds 25 megapixels.');
    const display = await sharp(input, {
      limitInputPixels: 25000000,
      failOn: 'error',
    })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const thumbnail = await sharp(input, {
      limitInputPixels: 25000000,
      failOn: 'error',
    })
      .rotate()
      .resize({
        width: 320,
        height: 320,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 76, mozjpeg: true })
      .toBuffer();
    if (display.length > 20971520 || thumbnail.length > 20971520)
      throw new Error('Normalized image exceeds 20 MiB.');
    parentPort.postMessage({ ok: true, variants: [display, thumbnail] });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : 'Inspection failed.',
    });
  }
});
