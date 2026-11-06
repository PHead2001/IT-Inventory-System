import { expect, it } from 'vitest';
import { inventoryReturnPath } from './create-return';
import {
  recordDetailReturnPath,
  locationDetailReturnPath,
  locationRowAnchor,
  detailRecordHref,
} from './detail-return';

const id = '00000000-0000-4000-8000-000000000001';
const browserParent = `/locations?q=Office&selected=ITC-S4B&level=ITC&expanded=ITC#location-row-desktop-tree-${id}`;
it('retains one canonical directory parent through location inventory and record detail only', () => {
  const href =
    '/locations/ITC-S4B?' +
    new URLSearchParams({
      q: 'Cable',
      view: 'items',
      density: 'compact',
      returnTo: browserParent,
    }) +
    '#inventory-row-2';
  expect(recordDetailReturnPath(href)).toBe(href);
  expect(recordDetailReturnPath(recordDetailReturnPath(href))).toBe(href);
  const recordHref = new URL(
    detailRecordHref('quantity', id, href),
    'https://inventory.invalid',
  );
  const restored = new URL(
    recordHref.searchParams.get('returnTo')!,
    'https://inventory.invalid',
  );
  expect(restored.pathname).toBe('/locations/ITC-S4B');
  expect(restored.hash).toBe('#inventory-row-2');
  expect(locationDetailReturnPath(restored.searchParams.get('returnTo'))).toBe(
    browserParent,
  );
  expect(
    new URL(
      inventoryReturnPath(href),
      'https://inventory.invalid',
    ).searchParams.has('returnTo'),
  ).toBe(false);
});
it.each([
  'https://hostile.test/locations',
  '//hostile.test/locations',
  'https://inventory.invalid/locations',
  'https://user@inventory.invalid/locations',
  '/inventory',
  '/locations/ITC-S4B',
  '/loc%61tions',
  '/locations?returnTo=%2Flocations',
  '/locations?q=one&q=two',
  '/locations?selected=..',
  '/locations?level=%5cbad',
  '/locations?unknown=true',
  '/locations#inventory-row-2',
  '/locations?q=%00',
  '/locations?q=%GG',
])('rejects an unsafe, recursive or non-directory parent %j', (parent) => {
  const href =
    '/locations/ITC-S4B?' +
    new URLSearchParams({ returnTo: parent }) +
    '#inventory-row-2';
  expect(recordDetailReturnPath(href)).toBe('/inventory');
});
it('rejects duplicate directory parents and leaves other route return policies unchanged', () => {
  const params = new URLSearchParams();
  params.append('returnTo', browserParent);
  params.append('returnTo', browserParent);
  expect(recordDetailReturnPath('/locations/ITC-S4B?' + params)).toBe(
    '/inventory',
  );
  for (const path of ['/inventory', '/sites/IT'])
    expect(
      new URL(
        recordDetailReturnPath(
          path + '?' + new URLSearchParams({ returnTo: browserParent }),
        ),
        'https://inventory.invalid',
      ).searchParams.has('returnTo'),
    ).toBe(false);
});
it('preserves safe filtered location inventory detail returns without broadening All locations Back', () => {
  const href =
    '/locations/ITC-S4B?type=quantity&view=items&density=compact&page=2#inventory-row-3';
  expect(recordDetailReturnPath(href)).toBe(href);
  expect(locationDetailReturnPath(href)).toBe('/locations');
  for (const path of [
    '/locations/a%2fb',
    '/locations/bad%20code',
    '/locations/%5cbad',
    '//hostile.test/locations/ITC',
  ])
    expect(recordDetailReturnPath(path)).toBe('/inventory');
});
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
