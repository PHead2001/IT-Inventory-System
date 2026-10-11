import { z } from 'zod';

const maximumCount = '9223372036854775807';
const decimal = z
  .string()
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => value.length < 19 || value <= maximumCount);
export const locationOccupancySchema = z.strictObject({
  quantity_product_count: decimal,
  quantity_unit_count: decimal,
  asset_count: decimal,
});
export type LocationOccupancy = z.infer<typeof locationOccupancySchema>;
export type RoomOccupancy = Record<string, LocationOccupancy>;

export function occupiedLocation(value: LocationOccupancy | undefined) {
  return value &&
    (BigInt(value.quantity_unit_count) > 0n || BigInt(value.asset_count) > 0n)
    ? value
    : null;
}

/** Only display formatting crosses BigInt; counts never become JS numbers. */
export function occupancyText(value: LocationOccupancy) {
  const format = (count: string, word: string) =>
    `${BigInt(count).toLocaleString('en-US')} ${word}${count === '1' ? '' : 's'}`;
  return [
    ...(value.quantity_product_count !== '0'
      ? [
          format(value.quantity_product_count, 'product'),
          format(value.quantity_unit_count, 'unit'),
        ]
      : []),
    ...(value.asset_count !== '0' ? [format(value.asset_count, 'asset')] : []),
  ].join(' / ');
}
