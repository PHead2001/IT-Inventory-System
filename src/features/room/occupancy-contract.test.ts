import { expect, it } from 'vitest';
import {
  locationOccupancySchema,
  occupiedLocation,
  occupancyText,
} from './occupancy-contract';
it('keeps products, units and assets distinct without losing integer precision', () => {
  const counts = {
    quantity_product_count: '1',
    quantity_unit_count: '9007199254740993',
    asset_count: '2',
  };
  expect(occupancyText(counts)).toBe(
    '1 product / 9,007,199,254,740,993 units / 2 assets',
  );
  expect(occupiedLocation(counts)).toEqual(counts);
  expect(occupiedLocation(undefined)).toBeNull();
  expect(
    occupiedLocation({
      quantity_product_count: '0',
      quantity_unit_count: '0',
      asset_count: '0',
    }),
  ).toBeNull();
});
it.each([
  '01',
  '-1',
  '1.5',
  'Infinity',
  '',
  1,
  '9223372036854775808',
  '9999999999999999999',
  '10000000000000000000',
])('rejects noncanonical count %s', (count) => {
  expect(
    locationOccupancySchema.safeParse({
      quantity_product_count: '1',
      quantity_unit_count: count,
      asset_count: '0',
    }).success,
  ).toBe(false);
});

it('accepts the signed-bigint maximum as exact text', () => {
  expect(
    locationOccupancySchema.parse({
      quantity_product_count: '0',
      quantity_unit_count: '9223372036854775807',
      asset_count: '0',
    }).quantity_unit_count,
  ).toBe('9223372036854775807');
});
