import { describe, expect, it } from 'vitest';
import { linuxMemory } from '../../scripts/e2e-performance-reporter';

describe('sanitized E2E resource metrics', () => {
  it('uses available memory and actual swap consumption, not free memory alone', () => {
    expect(
      linuxMemory(
        'MemTotal: 6291456 kB\nMemFree: 512 kB\nMemAvailable: 1048576 kB\nSwapTotal: 1048576 kB\nSwapFree: 786432 kB\n',
      ),
    ).toEqual({
      totalMiB: 6144,
      availableMiB: 1024,
      swapUsedMiB: 256,
    });
  });

  it('refuses absent memory availability instead of presenting zero pressure', () => {
    expect(() =>
      linuxMemory('MemTotal: 6291456 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'),
    ).toThrow('unavailable');
  });
});
