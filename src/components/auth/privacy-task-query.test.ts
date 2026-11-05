import { expect, it } from 'vitest';
import { taskQueryDestination } from './privacy-task-query';

const asset = '/inventory/assets/a3010000-0000-4000-8000-0000000000ab';
const quantity = '/inventory/quantity/a3010000-0000-4000-8000-0000000000ab';
it('allows only the matching task and a validated return scope while preserving unrelated repeated values', () => {
  expect(taskQueryDestination(asset, asset + '?task=asset_move')).toBe(asset);
  expect(taskQueryDestination(quantity, quantity + '?task=quantity_move')).toBe(
    quantity,
  );
  expect(
    taskQueryDestination(
      asset + '?keep=A&keep=B',
      asset + '?keep=A&keep=B&returnTo=%2Finventory&task=asset_move',
    ),
  ).toBe(asset + '?keep=A&keep=B&returnTo=%2Finventory');
});
it.each([
  [asset, quantity + '?task=quantity_move'],
  [asset, asset + '?task=quantity_move'],
  [asset, asset + '?task=asset_move&task=asset_move'],
  [asset + '?task=asset_move', asset + '?task=asset_move'],
  [asset, asset + '?task=asset_move&returnTo='],
  [asset, asset + '?task=asset_move&returnTo=%2Finventory&returnTo=%2Fhistory'],
  [asset, asset + '?task=asset_move&returnTo=https%3A%2F%2Fevil.invalid'],
  [asset, asset + '?task=asset_move&returnTo=%2Finventory%3Fx%3D%25ZZ'],
  [asset + '?keep=A&keep=B', asset + '?keep=B&keep=A&task=asset_move'],
  [asset, asset + '?other=changed&task=asset_move'],
  [asset, asset + '?task=asset_move#unexpected'],
  [asset, 'https://evil.invalid' + asset + '?task=asset_move'],
  [asset, 'http://['],
])(
  'rejects a non-task or invalid delta from %s to %s',
  (source, destination) => {
    expect(taskQueryDestination(source, destination)).toBeNull();
  },
);
