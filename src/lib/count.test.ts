import { expect, it } from 'vitest';
import { countLabel } from './count';
it.each([
  [0, '0 units'],
  [1, '1 unit'],
  [2, '2 units'],
  ['1', '1 unit'],
  [1n, '1 unit'],
])('formats %s without changing the counted unit', (count, expected) => {
  expect(countLabel(count, 'unit')).toBe(expected);
});
it('supports explicit plural nouns and separate record and label counts', () => {
  expect(countLabel(1, 'distinct record')).toBe('1 distinct record');
  expect(countLabel(2, 'quantity holding')).toBe('2 quantity holdings');
  expect(countLabel(1, 'label')).toBe('1 label');
});
