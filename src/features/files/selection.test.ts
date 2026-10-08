import { expect, it } from 'vitest';
import { validateSelectedFile } from './selection';
it('shares supported types, size limits and safe-name handling without accepting PDFs as quantity photos', () => {
  const pdf = { name: 'fixture.pdf', type: 'application/pdf', size: 100 };
  expect(validateSelectedFile(pdf, 'asset')).toBe('fixture.pdf');
  expect(() => validateSelectedFile(pdf, 'quantity')).toThrow('Choose a JPEG');
  expect(() =>
    validateSelectedFile({ ...pdf, size: 20971521 }, 'asset'),
  ).toThrow('20 MiB');
  expect(() => validateSelectedFile({ ...pdf, size: 0 }, 'asset')).toThrow(
    '20 MiB',
  );
  expect(
    validateSelectedFile(
      { name: ' ../photo.png ', type: 'image/png', size: 1 },
      'quantity',
    ),
  ).toBe('.._photo.png');
});
