import { expect, it } from 'vitest';
import {
  emptyLocationBrowserState,
  locationBrowserHref,
  parseLocationBrowserState,
} from './location-browser-state';
import type { LocationRef } from '@/features/inventory/contracts-ui';
export const locations: LocationRef[] = [
  {
    id: 'root',
    code: 'ITC',
    name: 'Closet',
    breadcrumb: 'Closet',
    parentId: null,
    active: true,
    can_hold_inventory: false,
  },
  {
    id: 'shelf',
    code: 'ITC-S1A',
    name: 'Shelf',
    breadcrumb: 'Closet / Shelf',
    parentId: 'root',
    active: true,
    can_hold_inventory: true,
  },
];
it('resolves restored state against fresh authorized locations and expandable groups', () => {
  expect(
    parseLocationBrowserState(
      new URLSearchParams(
        'q=Shelf&selected=missing&level=ITC-S1A&expanded=ITC&expanded=ITC&expanded=ITC-S1A&expanded=removed',
      ),
      locations,
    ),
  ).toEqual({
    query: 'Shelf',
    selectedCode: null,
    levelCode: undefined,
    expandedCodes: ['ITC'],
  });
  expect(
    parseLocationBrowserState(
      new URLSearchParams('selected=ITC-S1A&level='),
      locations,
    ),
  ).toMatchObject({ selectedCode: 'ITC-S1A', levelCode: null });
});
it('roundtrips exact bounded query/selection/mobile-level/expansion without dropping state', () => {
  const state = {
    query: ' Shelf ',
    selectedCode: 'ITC-S1A',
    levelCode: 'ITC',
    expandedCodes: ['ITC'],
  };
  expect(
    parseLocationBrowserState(
      new URL(locationBrowserHref(state), 'https://inventory.invalid')
        .searchParams,
      locations,
    ),
  ).toEqual(state);
});
it('rejects oversize state instead of silently shortening query or discarding expansions', () => {
  const state = { ...emptyLocationBrowserState(), query: 'x'.repeat(201) };
  expect(locationBrowserHref(state)).toContain('x'.repeat(201));
  expect(
    parseLocationBrowserState(
      new URL(locationBrowserHref(state), 'https://inventory.invalid')
        .searchParams,
    ),
  ).toBeNull();
  expect(
    parseLocationBrowserState(
      new URLSearchParams(
        Array.from({ length: 33 }, (_, i) => ['expanded', 'group' + i]),
      ),
    ),
  ).toBeNull();
  const tooLong = {
    ...emptyLocationBrowserState(),
    expandedCodes: Array.from(
      { length: 30 },
      (_, i) => 'group' + i + 'a'.repeat(150),
    ),
  };
  expect(
    parseLocationBrowserState(
      new URL(locationBrowserHref(tooLong), 'https://inventory.invalid')
        .searchParams,
    ),
  ).toBeNull();
});
