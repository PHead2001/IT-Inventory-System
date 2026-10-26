import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLocationBrowserNavigation } from './location-browser-navigation';
import {
  emptyLocationBrowserState,
  locationBrowserHref,
} from './location-browser-state';
import type { LocationRef } from '@/features/inventory/contracts-ui';
const locations: LocationRef[] = [
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
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  const emit = vi.fn(),
    replace = vi.fn(),
    rejected = vi.fn();
  let valid = true;
  const controller = createLocationBrowserNavigation(
    emptyLocationBrowserState(),
    locations,
    () => locations,
    emit,
    replace,
    () => valid,
    rejected,
  );
  return {
    controller,
    emit,
    replace,
    rejected,
    withdraw: () => {
      valid = false;
    },
  };
}
it('keeps live typing and detail return scope, then cancels the stale debounce before leaving', () => {
  const { controller, replace } = fixture();
  controller.change({ query: 'Shelf' }, true);
  expect(controller.snapshot().query).toBe('Shelf');
  expect(replace).not.toHaveBeenCalled();
  const returnScope = locationBrowserHref(
    controller.snapshot(),
    'location-row-mobile-level-id',
  );
  controller.leave();
  vi.advanceTimersByTime(1000);
  expect(replace).not.toHaveBeenCalled();
  expect(returnScope).toBe('/locations?q=Shelf#location-row-mobile-level-id');
  controller.reconcile(
    {
      query: 'Shelf',
      selectedCode: 'ITC-S1A',
      levelCode: 'ITC',
      expandedCodes: ['ITC'],
    },
    '/locations?q=Shelf&selected=ITC-S1A&level=ITC&expanded=ITC',
  );
  controller.activate();
  expect(controller.snapshot()).toEqual({
    query: 'Shelf',
    selectedCode: 'ITC-S1A',
    levelCode: 'ITC',
    expandedCodes: ['ITC'],
  });
});
it('selection and expansion coalesce the latest full draft and supersede an older search timer', () => {
  const { controller, replace } = fixture();
  controller.change({ query: 'She' }, true);
  vi.advanceTimersByTime(100);
  controller.change({ query: 'Shelf' }, true);
  controller.change({ selectedCode: 'ITC-S1A' });
  controller.change({ levelCode: 'ITC', expandedCodes: ['ITC'] });
  expect(replace.mock.calls.map((c) => c[0])).toEqual([
    '/locations?q=Shelf&selected=ITC-S1A',
    '/locations?q=Shelf&selected=ITC-S1A&level=ITC&expanded=ITC',
  ]);
  vi.advanceTimersByTime(1000);
  expect(replace).toHaveBeenCalledTimes(2);
});

it('passive native cancellation clears pending writes without disabling fresh user changes', () => {
  const { controller, replace } = fixture();
  controller.change({ selectedCode: 'ITC-S1A' });
  controller.change({ query: 'stale search' }, true);
  controller.cancelPending();
  vi.advanceTimersByTime(1000);
  expect(replace).toHaveBeenCalledTimes(1);
  // An actual history state can reconcile without an obsolete request identity.
  controller.reconcile(emptyLocationBrowserState(), '/locations');
  expect(controller.snapshot()).toEqual(emptyLocationBrowserState());
  controller.change({ query: 'fresh search' }, true);
  vi.advanceTimersByTime(300);
  expect(replace).toHaveBeenLastCalledWith('/locations?q=fresh+search');
  controller.change({ selectedCode: 'ITC-S1A' });
  expect(replace).toHaveBeenLastCalledWith(
    '/locations?q=fresh+search&selected=ITC-S1A',
  );
  expect(replace).toHaveBeenCalledTimes(3);
});

it('revoked change callbacks cannot mutate drafts, emit UI state, reject input or schedule writes', () => {
  const { controller, replace, emit, rejected, withdraw } = fixture();
  const previous = controller.snapshot();
  withdraw();
  controller.change({ query: 'revoked' }, true);
  controller.change({ query: 'x'.repeat(201) }, true);
  controller.change({ selectedCode: 'ITC-S1A' });
  controller.cancelPending();
  vi.advanceTimersByTime(1000);
  expect(controller.snapshot()).toBe(previous);
  expect(emit).not.toHaveBeenCalled();
  expect(rejected).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
it('an old server response never overwrites a later pending draft or its timer', () => {
  const { controller, replace } = fixture();
  controller.change({ selectedCode: 'ITC-S1A' });
  controller.change({ query: 'new' }, true);
  controller.reconcile(
    { ...emptyLocationBrowserState(), selectedCode: 'ITC-S1A' },
    '/locations?selected=ITC-S1A',
  );
  expect(controller.snapshot().query).toBe('new');
  vi.advanceTimersByTime(300);
  expect(replace).toHaveBeenLastCalledWith('/locations?q=new&selected=ITC-S1A');
  controller.reconcile(
    { ...emptyLocationBrowserState(), selectedCode: 'ITC-S1A' },
    '/locations?selected=ITC-S1A',
  );
  expect(controller.snapshot().query).toBe('new');
});
it.each(['withdraw', 'close', 'leave'] as const)(
  '%s prevents delayed replace and stale action updates',
  (mode) => {
    const { controller, replace, withdraw } = fixture();
    controller.change({ query: 'Shelf' }, true);
    if (mode === 'withdraw') withdraw();
    else controller[mode]();
    vi.advanceTimersByTime(500);
    expect(replace).not.toHaveBeenCalled();
  },
);
it('rejects an over-budget draft visibly while preserving the exact accepted draft', () => {
  const { controller, rejected } = fixture();
  controller.change({ query: 'okay' }, true);
  controller.change({ query: 'x'.repeat(201) }, true);
  expect(rejected).toHaveBeenLastCalledWith(true);
  expect(controller.snapshot().query).toBe('okay');
});

it('delayed writes use only callbacks from the latest committed binding', () => {
  const { controller, replace } = fixture();
  const currentReplace = vi.fn();
  controller.change({ query: 'Shelf' }, true);
  controller.bind({
    locations: () => locations,
    replace: currentReplace,
    valid: () => true,
  });
  vi.advanceTimersByTime(300);
  expect(replace).not.toHaveBeenCalled();
  expect(currentReplace).toHaveBeenCalledWith('/locations?q=Shelf');
  controller.change({ query: 'Later' }, true);
  controller.bind({
    locations: () => locations,
    replace: currentReplace,
    valid: () => false,
  });
  vi.advanceTimersByTime(300);
  expect(currentReplace).toHaveBeenCalledTimes(1);
});

it('retains one unsent revision across paused writes and old replies, then sends it once on fresh admission', () => {
  const { controller, replace } = fixture();
  let writable = false;
  controller.bind({
    locations: () => locations,
    replace,
    valid: () => true,
    writable: () => writable,
  });
  controller.change({ query: 'draft' }, true);
  vi.advanceTimersByTime(300);
  controller.change({ selectedCode: 'ITC-S1A' });
  controller.reconcile(emptyLocationBrowserState(), '/locations');
  expect(controller.snapshot().query).toBe('draft');
  expect(replace).not.toHaveBeenCalled();
  writable = true;
  controller.resumeWrites();
  controller.resumeWrites();
  expect(replace).toHaveBeenCalledExactlyOnceWith(
    '/locations?q=draft&selected=ITC-S1A',
  );
});

it.each(['cancelPending', 'leave', 'close'] as const)(
  '%s discards paused work, including an expired search debounce',
  (method) => {
    const { controller, replace } = fixture();
    let writable = false;
    controller.bind({
      locations: () => locations,
      replace,
      valid: () => true,
      writable: () => writable,
    });
    controller.change({ query: 'draft' }, true);
    vi.advanceTimersByTime(300);
    controller[method]();
    writable = true;
    controller.activate();
    controller.resumeWrites();
    expect(replace).not.toHaveBeenCalled();
  },
);
