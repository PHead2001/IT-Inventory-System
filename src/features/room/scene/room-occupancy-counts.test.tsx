import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { occupancyText, type LocationOccupancy } from '../occupancy-contract';
import { RoomOccupancyCounts } from './room-occupancy-counts';

it.each([
  ['0', '0', '0', false],
  ['0', '0', '0', true],
  ['1', '0', '0', false],
  ['0', '0', '1', false],
  ['2', '31', '1', false],
  ['1', '9007199254740993', '9223372036854775807', true],
] as const)(
  'retains exact occupancy formatting for %s/%s/%s (zeroes %s)',
  (products, units, assets, includeZero) => {
    const occupancy: LocationOccupancy = {
      quantity_product_count: products,
      quantity_unit_count: units,
      asset_count: assets,
    };
    const view = render(
      <RoomOccupancyCounts occupancy={occupancy} includeZero={includeZero} />,
    );
    const finals = [...view.container.querySelectorAll('[data-count-final]')];
    const expected = occupancyText(occupancy, includeZero);
    expect(finals.map((element) => element.textContent).join(' / ')).toBe(
      expected,
    );
    expect(
      [...view.container.querySelectorAll('[data-count-visual]')]
        .map((element) => element.textContent)
        .join(' / '),
    ).toBe(expected);
    expect(view.container.querySelector('[aria-live]')).toBeNull();
    const footprints = [
      ...view.container.querySelectorAll('[data-count-footprint]'),
    ];
    expect(footprints).toHaveLength(finals.length * 2);
    expect(
      footprints.every(
        (element) => element.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    // Separators are literal siblings; hidden footprint text is not an oracle.
    expect(
      [...view.container.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(''),
    ).toBe(finals.length > 0 ? ' / '.repeat(finals.length - 1) : '');
  },
);
