import { expect, it } from 'vitest';
import { restockShortfall } from './restock-shortfall';

it.each([
  [30, '25', '5'],
  ['9007199254740993', '9007199254740992', '1'],
  ['9007199254740993', '9007199254740993', '0'],
  [null, '9007199254740993', null],
  [30, '0', '30'],
  [0, '0', '0'],
  [30, '30', '0'],
  [30, '31', '0'],
  [null, '0', null],
  [30, undefined, null],
  [30, null, null],
  [30, 25, '5'],
  [2147483647, '9007199254740993', '0'],
  [2147483647, '9223372036854775807', '0'],
] as const)(
  'derives shortfall for threshold %s and available %s',
  (threshold, available, expected) => {
    expect(restockShortfall(threshold, available)).toBe(expected);
  },
);
