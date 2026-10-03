import { describe, expect, it } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import {
  availableSpaces,
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
  {
    id: '5',
    code: 'STAGING',
    name: 'Staging',
    breadcrumb: 'IT Office / Staging',
    active: true,
    can_hold_inventory: true,
    parentId: '3',
  },
  {
    id: '6',
    code: 'ITO-SPOOF',
    name: 'Spoof',
    breadcrumb: 'Unregistered / Spoof',
    active: true,
    can_hold_inventory: true,
    parentId: null,
  },
];
describe('space registry', () => {
  it('resolves old deep links to their containing space and keeps office inventory-only', () => {
    expect(containingSpace(locations, 'ITO-GENERAL')?.id).toBe('it-office');
    expect(containingSpace(locations, 'STAGING')?.id).toBe('it-office');
    expect(containingSpace(locations, 'ITO-SPOOF')).toBeNull();
    expect(resolveSpace(locations, null, 'ITO-GENERAL')?.id).toBe('it-office');
    expect(spaceRoom(resolveSpace(locations, 'it-office', null)!)).toBeNull();
    expect(
      spaceLocations(
        locations,
        resolveSpace(locations, 'it-office', null)!,
      ).map((location) => location.code),
    ).toEqual(['ITO', 'ITO-GENERAL', 'STAGING']);
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

it('uses authorized live root names in space navigation while keeping code, model and descendants', () => {
  const renamed = locations.map((location) =>
    location.code === 'ITC'
      ? { ...location, name: 'Equipment storage' }
      : location,
  );
  const current = resolveSpace(renamed, 'it-closet', null)!;
  expect(current.name).toBe('Equipment storage');
  expect(current.rootCode).toBe('ITC');
  expect(current.geometryId).toBe('it-closet');
  expect(
    availableSpaces(renamed).find((space) => space.id === 'it-closet')?.name,
  ).toBe('Equipment storage');
  expect(containingSpace(renamed, 'ITC-D01')?.name).toBe('Equipment storage');
  expect(
    spaceLocations(renamed, current).map((location) => location.id),
  ).toEqual(['1', '2']);
  expect(spaceRoom(current)).toEqual(
    spaceRoom(resolveSpace(locations, 'it-closet', null)!),
  );
});
