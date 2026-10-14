import { expect, it } from 'vitest';
import { inventoryReturnPath } from './create-return';
import {
  recordDetailReturnPath,
  locationDetailReturnPath,
  locationRowAnchor,
} from './detail-return';

const id = '00000000-0000-4000-8000-000000000001';
it('allows canonical main history detail origins without broadening whole-form Cancel', () => {
  const origin = `/history?type=quantity&location=ITC&entityId=${id}&page=2#history-event-quantity-${id}`;
  expect(recordDetailReturnPath(origin)).toBe(origin);
  expect(recordDetailReturnPath('/history?type=all&page=1')).toBe('/history');
  expect(inventoryReturnPath(origin)).toBe('/inventory');
  expect(inventoryReturnPath('/locations?selected=ITC')).toBe('/inventory');
  expect(recordDetailReturnPath('/inventory?q=Cable#inventory-row-2')).toBe(
    '/inventory?q=Cable#inventory-row-2',
  );
});
it.each([
  'https://hostile.test/history',
  '//hostile.test/history',
  '/history?event=asset:' + id,
  '/history?side=before',
  '/history?field=' + id,
  '/history?optionOffset=2',
  '/history?type=asset&type=quantity',
  '/history?entityId=not-uuid',
  '/history?page=0',
  '/history?location=%5cfoo',
  '/history?location=%00',
  '/history?type=bogus',
  '/history%2f../inventory',
  '/locations?selected=../bad',
  '/locations?q=%00',
  '/locations?q=' + 'x'.repeat(201),
  '/locations?unknown=true',
  '/history?location=%GG',
])('rejects unsafe or detail-mode origin %s', (origin) => {
  expect(recordDetailReturnPath(origin)).toBe('/inventory');
});
it('retains bounded location draft and exact occurrence while rejecting foreign All locations targets', () => {
  const anchor = locationRowAnchor(id, 'mobile-level');
  const origin = `/locations?q=+Cable+&selected=ITC&level=&expanded=ITC#${anchor}`;
  expect(recordDetailReturnPath(origin)).toBe(origin);
  expect(locationDetailReturnPath(origin)).toBe(origin);
  expect(locationDetailReturnPath('/history')).toBe('/locations');
  expect(recordDetailReturnPath('/locations#not-an-occurrence')).toBe(
    '/locations',
  );
});
