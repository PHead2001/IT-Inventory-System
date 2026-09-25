import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const workerPath = resolve('src/features/files/inspect-worker.cjs');
const maxBytes = 20 * 1024 * 1024;
let checks = 0;

type Inspection =
  { ok: true; variants: Uint8Array[] } | { ok: false; message: string };

async function inspect(bytes: Uint8Array, type: string): Promise<Inspection> {
  const worker = new Worker(workerPath, {
    resourceLimits: {
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 32,
    },
  });
  try {
    return await new Promise<Inspection>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error('Worker did not settle')),
        20_000,
      );
      worker.once('message', (message: Inspection) => {
        clearTimeout(timer);
        done(message);
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      worker.postMessage({ bytes, type });
    });
  } finally {
    const exit = await worker.terminate();
    assert.ok(
      Number.isInteger(exit),
      'inspection worker terminates after a result',
    );
  }
}

async function accepted(bytes: Uint8Array, type: string) {
  const result = await inspect(bytes, type);
  assert.equal(result.ok, true, `${type}: ${result.ok ? '' : result.message}`);
  checks++;
  return result.variants;
}

async function denied(bytes: Uint8Array, type: string, pattern: RegExp) {
  const result = await inspect(bytes, type);
  assert.equal(result.ok, false, `${type} unexpectedly passed`);
  assert.match(result.message, pattern);
  checks++;
}

async function imageFixtures() {
  const base = sharp({
    create: { width: 80, height: 40, channels: 4, background: '#fa3456' },
  });
  const jpeg = await base.clone().jpeg().toBuffer();
  const png = await base.clone().png().toBuffer();
  const webp = await base.clone().webp().toBuffer();
  for (const [bytes, type] of [
    [jpeg, 'image/jpeg'],
    [png, 'image/png'],
    [webp, 'image/webp'],
  ] as const) {
    const variants = await accepted(bytes, type);
    assert.equal(variants.length, 2);
    for (const variant of variants) {
      const metadata = await sharp(variant).metadata();
      assert.equal(metadata.format, 'jpeg');
      assert.equal(metadata.width, 80);
      assert.equal(metadata.height, 40);
      assert.equal(metadata.exif, undefined);
    }
    checks++;
  }
  await denied(jpeg, 'image/png', /does not match/i);
  await denied(png, 'image/jpeg', /does not match/i);
  await denied(webp, 'application/pdf', /Invalid PDF signature/i);
  await denied(
    Buffer.from('<html><script>alert(1)</script></html>'),
    'image/jpeg',
    /does not match/i,
  );
  await denied(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'image/png',
    /does not match/i,
  );
  await denied(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html>')]),
    'image/jpeg',
    /input|unsupported|corrupt|jpeg/i,
  );
  await denied(
    Buffer.from('0000ftypheic0000'),
    'image/jpeg',
    /HEIC\/HEIF is not supported/i,
  );

  const oriented = await sharp({
    create: { width: 80, height: 40, channels: 4, background: '#fa3456' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const orientedMeta = await sharp(oriented).metadata();
  assert.equal(orientedMeta.orientation, 6);
  assert.ok(orientedMeta.exif);
  const variants = await accepted(oriented, 'image/jpeg');
  for (const variant of variants) {
    const metadata = await sharp(variant).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 40);
    assert.equal(metadata.height, 80);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
  }
  checks++;

  const frames = Buffer.alloc(8 * 16 * 4);
  for (let pixel = 0; pixel < 8 * 16; pixel++) {
    frames[pixel * 4] = pixel < 64 ? 255 : 0;
    frames[pixel * 4 + 1] = pixel < 64 ? 0 : 255;
    frames[pixel * 4 + 3] = 255;
  }
  const animation = await sharp(frames, {
    raw: { width: 8, height: 16, channels: 4, pageHeight: 8 },
    animated: true,
    pages: 2,
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.ok((await sharp(animation, { animated: true }).metadata()).pages! > 1);
  await denied(animation, 'image/webp', /Unsupported image|25 megapixels/i);

  const overPixels = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  await denied(overPixels, 'image/png', /pixel|25 megapixels|input/i);
  await denied(new Uint8Array(maxBytes + 1), 'image/png', /exceeds 20 MiB/i);
}

async function pdfFixtures() {
  const normal = await PDFDocument.create();
  normal.addPage([72, 72]);
  const valid = await normal.save();
  assert.deepEqual(await accepted(valid, 'application/pdf'), []);
  await denied(valid, 'image/png', /does not match/i);
  await denied(
    Buffer.from('%PDF-not-a-document'),
    'application/pdf',
    /parse|invalid|pdf/i,
  );
  await denied(
    Buffer.from('<html>not a pdf</html>'),
    'application/pdf',
    /Invalid PDF signature/i,
  );

  const tooManyPages = await PDFDocument.create();
  for (let index = 0; index < 251; index++) tooManyPages.addPage([72, 72]);
  await denied(
    await tooManyPages.save(),
    'application/pdf',
    /Encrypted or overly complex PDF/i,
  );

  const complex = await PDFDocument.create();
  complex.addPage([72, 72]);
  for (let index = 0; index < 10001; index++)
    complex.context.register(complex.context.obj({ value: index }));
  await denied(
    await complex.save(),
    'application/pdf',
    /Encrypted or overly complex PDF/i,
  );

  const encrypted = await PDFDocument.create();
  encrypted.addPage([72, 72]);
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
    encrypted.context.obj({ Filter: 'Standard', V: 1, R: 2, P: -4 }),
  );
  await denied(await encrypted.save(), 'application/pdf', /encrypt/i);
}

await imageFixtures();
await pdfFixtures();
console.log(
  `Real file-inspection worker accepted/rejected ${checks} cases and terminated after each.`,
);
