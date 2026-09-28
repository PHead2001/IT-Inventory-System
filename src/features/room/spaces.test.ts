import { describe, expect, it } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import {
  containingSpace,
  resolveSpace,
  spaceLocations,
  spaceRoom,
} from './spaces';

const locations: LocationRef[] = [
  {
    id: '1',
    code: 'ITC',
    name: 'IT Closet',
    breadcrumb: 'IT Closet',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
  {
    id: '2',
    code: 'ITC-D01',
    name: 'Drawer 1',
    breadcrumb: 'IT Closet / Drawer 1',
    active: true,
    can_hold_inventory: true,
    parentId: '1',
  },
  {
    id: '3',
    code: 'ITO',
    name: 'IT Office',
    breadcrumb: 'IT Office',
    active: true,
    can_hold_inventory: false,
    parentId: null,
  },
  {
    id: '4',
    code: 'ITO-GENERAL',
    name: 'General',
    breadcrumb: 'IT Office / General',
    active: true,
    can_hold_inventory: true,
    parentId: '3',
  },
];
describe('space registry', () => {
  it('resolves old deep links to their containing space and keeps office inventory-only', () => {
    expect(containingSpace(locations, 'ITO-GENERAL')?.id).toBe('it-office');
    expect(resolveSpace(locations, null, 'ITO-GENERAL')?.id).toBe('it-office');
    expect(spaceRoom(resolveSpace(locations, 'it-office', null)!)).toBeNull();
    expect(
      spaceLocations(
        locations,
        resolveSpace(locations, 'it-office', null)!,
      ).map((location) => location.code),
    ).toEqual(['ITO', 'ITO-GENERAL']);
  });
  it('falls back from invalid or inactive choices to the configured default', () => {
    expect(resolveSpace(locations, 'missing', null)?.id).toBe('it-closet');
    expect(
      resolveSpace(
        locations.map((location) =>
          location.code === 'ITC' ? { ...location, active: false } : location,
        ),
        'it-closet',
        null,
      )?.id,
    ).toBe('it-office');
  });
});
