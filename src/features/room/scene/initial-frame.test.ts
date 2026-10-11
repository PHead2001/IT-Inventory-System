import { expect, it } from 'vitest';
import { createInitialFramePolicy } from './initial-frame';
it('waits through zero-size mount then fits once at the actual canvas size', () => {
  const policy = createInitialFramePolicy();
  expect(policy.measure(0, 0, false)).toBe('wait');
  expect(policy.measure(375, 0, false)).toBe('wait');
  expect(policy.measure(310, 410, false)).toBe('fit');
  expect(policy.measure(960, 550, false)).toBe('preserve');
});
it('preserves toolbar/manual intent before measurement and restored context across later resize', () => {
  const policy = createInitialFramePolicy();
  policy.manual();
  expect(policy.measure(0, 0, false)).toBe('wait');
  expect(policy.measure(310, 410, false)).toBe('preserve');
  policy.reset();
  expect(policy.measure(310, 410, true)).toBe('restore');
  policy.manual();
  expect(policy.measure(960, 550, true)).toBe('preserve');
});
