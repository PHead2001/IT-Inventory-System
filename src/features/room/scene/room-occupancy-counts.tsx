'use client';

import { Fragment } from 'react';
import { CountTicker } from '@/components/experience/count-ticker';
import type { LocationOccupancy } from '../occupancy-contract';

/** Visual presentation only; occupancyText remains the label's final authority. */
export function RoomOccupancyCounts({
  occupancy,
  includeZero = false,
}: {
  occupancy: LocationOccupancy;
  includeZero?: boolean;
}) {
  const groups = [
    ...(includeZero || occupancy.quantity_product_count !== '0'
      ? [
          { value: occupancy.quantity_product_count, unit: 'product' },
          { value: occupancy.quantity_unit_count, unit: 'unit' },
        ]
      : []),
    ...(includeZero || occupancy.asset_count !== '0'
      ? [{ value: occupancy.asset_count, unit: 'asset' }]
      : []),
  ];
  return groups.map(({ value, unit }, index) => (
    <Fragment key={unit}>
      {index > 0 && ' / '}
      <CountTicker
        value={value}
        unit={unit}
        grouped
        initialZero={false}
        announce={false}
      />
    </Fragment>
  ));
}
