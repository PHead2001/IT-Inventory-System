import { expect, it } from 'vitest';
import { resolveRoomMap, hasModeledRoomBinding } from './room-map-model';
import type { LocationRef } from '../inventory/contracts-ui';
const root: LocationRef = {
  id: 'root',
  code: 'ITC',
  name: 'Closet',
  breadcrumb: 'Closet',
  parentId: null,
  active: true,
  can_hold_inventory: false,
};
const child = (code: string): LocationRef => ({
  ...root,
  id: code,
  code,
  parentId: root.id,
  can_hold_inventory: true,
});
it('resolves actual canonical bindings rather than holding-location kind or ancestry alone', () => {
  expect(hasModeledRoomBinding([root, child('ITC-D01')], 'ITC-D01')).toBe(true);
  expect(hasModeledRoomBinding([root, child('ITC-EXTRA')], 'ITC-EXTRA')).toBe(
    false,
  );
  expect(hasModeledRoomBinding([root], 'ITC')).toBe(true);
  const first = resolveRoomMap([root, child('ITC-D01')], 'ITC-D01');
  const refreshed = resolveRoomMap([root, child('ITC-D01')], 'ITC-D01');
  expect(refreshed.room).toBe(first.room);
  expect(refreshed.bindings).toBe(first.bindings);
});
