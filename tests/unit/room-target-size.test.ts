import { expect, it } from 'vitest';
import { roomTargetMeetsMinimum } from '../e2e/room-target-size';

const translated = {
  layoutWidth: 44,
  layoutHeight: 44,
  width: 43.99999237060547,
  height: 44,
  translationOnly: true,
};
it('accepts only rounding noise for an authored 44px translation-only target', () => {
  expect(roomTargetMeetsMinimum(translated)).toBe(true);
});
it('rejects an actually undersized target despite rounded measured dimensions', () => {
  expect(
    roomTargetMeetsMinimum({ ...translated, layoutWidth: 43.9, width: 44 }),
  ).toBe(false);
  expect(roomTargetMeetsMinimum({ ...translated, width: 43.9 })).toBe(false);
  expect(
    roomTargetMeetsMinimum({ ...translated, layoutHeight: 43.9, height: 44 }),
  ).toBe(false);
});
it('does not apply the measurement allowance to scaled projections', () => {
  expect(
    roomTargetMeetsMinimum({ ...translated, translationOnly: false }),
  ).toBe(false);
});
