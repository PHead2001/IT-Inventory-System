import { describe, expect, it } from 'vitest';
import type { LocationRef } from '../inventory/contracts-ui';
import { orderedLocations, pickerLocations, pickerValue } from './picker-model';

const root: LocationRef = {
  id: 'root',
  code: 'ITC',
  name: 'IT Closet',
  breadcrumb: 'IT Closet',
  parentId: null,
  active: true,
  can_hold_inventory: false,
  sortOrder: 0,
};
const right: LocationRef = {
  id: 'right',
  code: 'ITC-R',
  name: 'Right Storage',
  breadcrumb: 'IT Closet / Right Storage',
  parentId: 'root',
  active: true,
  can_hold_inventory: false,
  sortOrder: 2,
};
const left: LocationRef = {
  id: 'left',
  code: 'ITC-L',
  name: 'Left Storage',
  breadcrumb: 'IT Closet / Left Storage',
  parentId: 'root',
  active: true,
  can_hold_inventory: false,
  sortOrder: 1,
};
const drawer7: LocationRef = {
  id: '7',
  code: 'ITC-D07',
  name: 'Drawer 7',
  breadcrumb: 'IT Closet / Right Storage / Drawer 7',
  parentId: 'right',
  active: true,
  can_hold_inventory: true,
};
const drawer10: LocationRef = {
  ...drawer7,
  id: '10',
  code: 'ITC-D10',
  name: 'Drawer 10',
  breadcrumb: 'IT Closet / Right Storage / Drawer 10',
};
const inactive: LocationRef = {
  ...drawer7,
  id: 'inactive',
  code: 'ITC-D11',
  name: 'Drawer 11',
  breadcrumb: 'IT Closet / Right Storage / Drawer 11',
  active: false,
};
const locations = [drawer10, right, inactive, root, drawer7, left];

describe('location picker model', () => {
  it('orders siblings by sort_order then numeric label within their hierarchy', () => {
    expect(orderedLocations(locations).map((location) => location.id)).toEqual([
      'root',
      'left',
      'right',
      '7',
      '10',
      'inactive',
    ]);
  });
  it('searches code, label and ancestry and keeps aggregate browsing distinct from destinations', () => {
    expect(
      pickerLocations(locations, 'browse', { query: 'right storage' }).map(
        (l) => l.id,
      ),
    ).toEqual(['right', '7', '10', 'inactive']);
    expect(
      pickerLocations(locations, 'browse', { query: 'itc-d07' }).map(
        (l) => l.id,
      ),
    ).toEqual(['7']);
    expect(
      pickerLocations(locations, 'destination', { excludeIds: ['7'] }).map(
        (l) => l.id,
      ),
    ).toEqual(['10']);
    expect(
      pickerLocations(locations, 'source', { sourceIds: ['inactive'] }).map(
        (l) => l.id,
      ),
    ).toEqual(['inactive']);
    expect(pickerValue(drawer7, 'browse')).toBe('ITC-D07');
    expect(pickerValue(drawer7, 'destination')).toBe('7');
  });
});
