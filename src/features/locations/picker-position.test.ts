import { expect, it } from 'vitest';
import { pickerPosition } from './picker-position';

it('matches trigger width and anchors below without covering the control', () => {
  const panel = pickerPosition(
    { left: 100, top: 100, bottom: 144, width: 240 },
    75,
    { width: 1000, height: 800 },
  );
  expect(panel).toEqual({ left: 100, top: 148, width: 240, height: 416 });
});
it('flips above the label and clamps the right viewport edge', () => {
  const panel = pickerPosition(
    { left: 850, top: 650, bottom: 694, width: 240 },
    620,
    { width: 1000, height: 800 },
  );
  expect(panel.top + panel.height).toBe(616);
  expect(panel.left + panel.width).toBe(984);
});
it('shrinks the panel to available vertical space instead of covering the trigger', () => {
  const panel = pickerPosition(
    { left: 20, top: 200, bottom: 244, width: 700 },
    170,
    { width: 640, height: 400 },
  );
  expect(panel.width).toBe(608);
  expect(panel.top + panel.height).toBeLessThan(170);
});
