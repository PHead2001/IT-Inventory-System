import { describe, expect, it } from 'vitest';
import { formatFileSize } from './file-size';

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [20, '20 B'],
    [1023, '1023 B'],
    [1024, '1 KiB'],
    [1536, '1.5 KiB'],
    [1048576, '1 MiB'],
    [20971520, '20 MiB'],
    [undefined, 'Size unavailable'],
    [null, 'Size unavailable'],
    [-1, 'Size unavailable'],
    [NaN, 'Size unavailable'],
  ])('formats %s as %s', (bytes, result) => {
    expect(formatFileSize(bytes)).toBe(result);
  });
});
