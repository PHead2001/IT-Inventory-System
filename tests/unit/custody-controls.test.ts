import { expect, it } from 'vitest';
import { custodyButtons, custodyReceiptTitle } from '../e2e/custody-controls';
it.each([
  [
    'Assign asset to a site',
    'asset',
    'Review assignment',
    'Assign to site',
    'Assigned to site',
  ],
  [
    'Issue stock to a site',
    'quantity',
    'Review issue',
    'Issue to site',
    'Issued to site',
  ],
  [
    'Transfer between sites',
    'quantity',
    'Review transfer',
    'Transfer between sites',
    'Transferred between sites',
  ],
  [
    'Write off at site',
    'quantity',
    'Review write-off',
    'Write off at site',
    'Quantity written off at site',
  ],
  [
    'Write off at site',
    'asset',
    'Review write-off',
    'Write off at site',
    'Asset written off at site',
  ],
  [
    'Return to storage',
    'asset',
    'Review return',
    'Return to storage',
    'Returned from site',
  ],
  [
    'Correct recorded site holding',
    'quantity',
    'Review correction',
    'Save correction',
    'Site count corrected',
  ],
] as const)(
  'matches controls and the specific committed receipt for %s / %s',
  (title, kind, review, confirm, receipt) => {
    expect(custodyButtons(title)).toEqual([review, confirm]);
    expect(custodyReceiptTitle(title, kind)).toBe(receipt);
  },
);
it('does not accept a generic receipt expectation for an unrelated task', () => {
  expect(() => custodyReceiptTitle('Move stock', 'quantity')).toThrow(
    'Unsupported custody task',
  );
});
