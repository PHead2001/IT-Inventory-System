import { expect, it } from 'vitest';
import {
  createRouteMotionState,
  titleTarget,
  matchesTitleListRoute,
  historyTitleTarget,
  locationTitleTarget,
  sameTitleSource,
  groupedTitleTarget,
  type InventorySource,
} from './route-motion-state';
import { routeKey } from './route-key';

const record = { kind: 'quantity' as const, id: 'quantity' };
const holding = { domain: 'storage' as const, id: 'storage' };
const original =
  '/inventory?type=quantity&q=USB%20Cable&category=a&category=b#inventory-row-2';
const rawAlias = routeKey(
  '/inventory',
  new URLSearchParams('type=all&status=active&q=++USB++&scopeAdjusted=true'),
);

const recordUuid = {
  kind: 'quantity' as const,
  id: '00000000-0000-4000-8000-000000000001',
};
const aggregateSource = { kind: 'inventory-aggregate' as const };
const groupedHref =
  '/inventory?density=comfortable&q=cable&view=items#inventory-row-2';
it('binds the canonical directory parent into exact location aggregate pairing and Back', () => {
  const parent =
    '/locations?q=Closet&selected=ITC-S4B&level=ITC&expanded=ITC#location-row-desktop-tree-' +
    recordUuid.id;
  const rawParams = new URLSearchParams({ q: 'cable', returnTo: parent });
  const raw = routeKey('/locations/ITC-S4B', rawParams);
  const params = new URLSearchParams(rawParams);
  params.set('view', 'items');
  params.set('density', 'comfortable');
  const href = '/locations/ITC-S4B?' + params + '#inventory-row-2';
  const source: InventorySource = {
    kind: 'location-inventory',
    locationCode: 'ITC-S4B',
    occurrence: { kind: 'aggregate' },
  };
  const target = groupedTitleTarget(recordUuid, source, href, raw)!;
  expect(target).not.toBeNull();
  expect(target.rawSourceRouteKey).toBe(raw);
  expect(
    new URL(target.listHref, 'https://inventory.invalid').searchParams.get(
      'returnTo',
    ),
  ).toBe(parent);
  const state = createRouteMotionState();
  state.arm(target);
  state.finish();
  expect(state.backTarget(recordUuid, href)).toEqual(target);
  params.set('returnTo', parent.replace('Closet', 'Office'));
  expect(
    state.backTarget(
      recordUuid,
      '/locations/ITC-S4B?' + params + '#inventory-row-2',
    ),
  ).toBeNull();
  expect(
    groupedTitleTarget(
      recordUuid,
      source,
      href,
      routeKey('/locations/ITC-S4B', params),
    ),
  ).toBeNull();
});
it('admits implicit server defaults only as explicit default grouped returns, retaining exact raw readiness', () => {
  const raw = '/inventory?q=cable';
  const target = groupedTitleTarget(
    recordUuid,
    aggregateSource,
    groupedHref,
    raw,
  )!;
  expect(target).not.toBeNull();
  expect(target.rawSourceRouteKey).toBe(raw);
  expect(matchesTitleListRoute(target, raw)).toBe(true);
  expect(matchesTitleListRoute(target, '/inventory?q=cable&view=items')).toBe(
    false,
  );
  expect(target).not.toHaveProperty('holding');
  expect(
    groupedTitleTarget(
      recordUuid,
      aggregateSource,
      groupedHref,
      '/inventory?columns=&q=cable',
    ),
  ).not.toBeNull();
  const state = createRouteMotionState();
  state.arm(target);
  state.finish();
  expect(state.backTarget(recordUuid, groupedHref)).toEqual(target);
  expect(
    state.backTarget(recordUuid, groupedHref.replace('row-2', 'row-3')),
  ).toBeNull();
  expect(
    state.backTarget(recordUuid, groupedHref.replace('cable', 'charger')),
  ).toBeNull();
});
it.each([
  '/inventory?density=compact&q=cable',
  '/inventory?q=cable&view=holdings',
  '/inventory?q=cable&view=bad',
  '/inventory?density=bad&q=cable',
  '/inventory?q=cable&view=items&view=items',
  '/inventory?density=comfortable&density=comfortable&q=cable',
  '/inventory?columns=not-a-uuid&q=cable',
  '/inventory?columns=' + recordUuid.id + ',' + recordUuid.id + '&q=cable',
  '/inventory?q=charger',
  '/inventory?q=cable#inventory-row-2',
  'https://hostile.test/inventory?q=cable',
  '/inventory?view=items&q=cable', // raw routeKey ordering must remain exact
])('rejects conflicting, invalid or non-exact grouped raw state %s', (raw) => {
  expect(
    groupedTitleTarget(recordUuid, aggregateSource, groupedHref, raw),
  ).toBeNull();
});
it.each(['ITC-S4B', 'ITC-4B'])(
  'binds location aggregate/holding origins, encoded code and exact occurrence: %s',
  (code) => {
    const path = '/locations/' + encodeURIComponent(code);
    const source: InventorySource = {
      kind: 'location-inventory',
      locationCode: code,
      occurrence: { kind: 'aggregate' },
    };
    const href =
      path + '?density=comfortable&page=2&view=items#inventory-row-1';
    const aggregate = groupedTitleTarget(recordUuid, source, href)!;
    const holding = groupedTitleTarget(
      recordUuid,
      {
        ...source,
        occurrence: {
          kind: 'holding',
          holding: { domain: 'storage', id: recordUuid.id },
        },
      },
      href.replace('view=items', 'view=holdings'),
    )!;
    expect(aggregate).not.toBeNull();
    expect(holding).not.toBeNull();
    expect(sameTitleSource(aggregate, holding)).toBe(false);
    expect(
      sameTitleSource(
        aggregate,
        groupedTitleTarget(
          recordUuid,
          { ...source, locationCode: 'OTHER' },
          href.replace(code, 'OTHER'),
        )!,
      ),
    ).toBe(false);
    const state = createRouteMotionState();
    state.arm(holding);
    state.finish();
    expect(
      state.backTarget(recordUuid, href.replace('view=items', 'view=holdings')),
    ).toEqual(holding);
    expect(state.backTarget(recordUuid, href)).toBeNull();
    expect(
      groupedTitleTarget(
        recordUuid,
        source,
        href,
        path + '?density=comfortable&page=3&view=items',
      ),
    ).toBeNull();
  },
);
it.each(['.', '..', 'a/b', 'a\\b', 'bad code', 'bad\u0000code', ''])(
  'rejects unsupported location source codes %j',
  (locationCode) => {
    expect(
      groupedTitleTarget(
        recordUuid,
        {
          kind: 'location-inventory',
          locationCode,
          occurrence: { kind: 'aggregate' },
        },
        '/locations/' +
          encodeURIComponent(locationCode) +
          '?view=items#inventory-row-2',
      ),
    ).toBeNull();
  },
);
it('does not pair grouped source/view conflicts, malformed records or foreign targets', () => {
  expect(groupedTitleTarget(record, aggregateSource, groupedHref)).toBeNull();
  expect(
    groupedTitleTarget(
      recordUuid,
      aggregateSource,
      groupedHref.replace('view=items', 'view=holdings'),
    ),
  ).toBeNull();
  expect(
    groupedTitleTarget(
      recordUuid,
      aggregateSource,
      'https://hostile.test' + groupedHref,
    ),
  ).toBeNull();
  expect(
    groupedTitleTarget(
      recordUuid,
      aggregateSource,
      groupedHref.replace('row-2', 'not-row'),
    ),
  ).toBeNull();
});

it('never substitutes compact for absent density and preserves validated explicit columns', () => {
  expect(
    groupedTitleTarget(
      recordUuid,
      aggregateSource,
      groupedHref.replace('comfortable', 'compact'),
      '/inventory?q=cable',
    ),
  ).toBeNull();
  expect(
    groupedTitleTarget(
      recordUuid,
      aggregateSource,
      groupedHref.replace('view=items', 'view=items&view=items'),
    ),
  ).toBeNull();
  const href = groupedHref.replace(
    'density=comfortable',
    'columns=' + recordUuid.id + '&density=compact',
  );
  const raw =
    '/inventory?columns=' +
    recordUuid.id +
    '&density=compact&q=cable&view=items';
  const target = groupedTitleTarget(recordUuid, aggregateSource, href, raw)!;
  expect(target).not.toBeNull();
  expect(
    new URL(target.listHref, 'https://inventory.invalid').searchParams.get(
      'columns',
    ),
  ).toBe(recordUuid.id);
});
const event = {
  kind: 'quantity' as const,
  id: '00000000-0000-4000-8000-000000000002',
};
const historyHref = `/history?type=quantity&entityId=${recordUuid.id}&page=2#history-event-quantity-${event.id}`;
it('pairs a main history event occurrence without inventing an inventory holding', () => {
  const target = historyTitleTarget(
    recordUuid,
    event,
    historyHref,
    routeKey(
      '/history',
      new URL(historyHref, 'https://inventory.invalid').searchParams,
    ),
  )!;
  expect(target.source).toEqual({
    kind: 'history-event',
    eventKind: event.kind,
    eventId: event.id,
  });
  expect(target).not.toHaveProperty('holding');
  const state = createRouteMotionState();
  state.arm(target);
  state.finish();
  expect(state.backTarget(recordUuid, historyHref)).toEqual(target);
  expect(
    state.backTarget(recordUuid, historyHref.replace('page=2', 'page=3')),
  ).toBeNull();
  const other = historyTitleTarget(
    recordUuid,
    { ...event, id: '00000000-0000-4000-8000-000000000003' },
    historyHref.replace(event.id, '00000000-0000-4000-8000-000000000003'),
  )!;
  expect(sameTitleSource(target, other)).toBe(false);
  expect(
    historyTitleTarget(
      recordUuid,
      event,
      historyHref,
      historyHref.split('#')[0].replace('page=2', 'page=3'),
    ),
  ).toBeNull();
  expect(
    historyTitleTarget(recordUuid, { ...event, kind: 'asset' }, historyHref),
  ).toBeNull();
  expect(
    historyTitleTarget(
      recordUuid,
      event,
      historyHref.replace('type=quantity', 'type=asset'),
    ),
  ).toBeNull();
  expect(
    historyTitleTarget(
      recordUuid,
      event,
      historyHref + '&event=quantity:' + event.id,
    ),
  ).toBeNull();
});
it.each(['desktop-tree', 'mobile-level', 'selected-panel'] as const)(
  'keeps exact location UUID, stable code and %s occurrence for application Back',
  (occurrence) => {
    const location = {
      kind: 'location' as const,
      id: recordUuid.id,
      code: 'ITC-S1A',
    };
    const href = `/locations?q=Shelf&selected=ITC-S1A#location-row-${occurrence}-${location.id}`;
    const target = locationTitleTarget(
      location,
      occurrence,
      href,
      href.split('#')[0],
    )!;
    expect(target.detailPath).toBe('/locations/ITC-S1A');
    expect(target).not.toHaveProperty('holding');
    const state = createRouteMotionState();
    state.arm(target);
    state.finish();
    expect(state.backTarget(location, href)).toEqual(target);
    expect(state.backTarget({ ...location, code: 'other' }, href)).toBeNull();
    expect(
      state.backTarget(
        location,
        href.replace(
          occurrence,
          occurrence === 'desktop-tree' ? 'mobile-level' : 'desktop-tree',
        ),
      ),
    ).toBeNull();
    expect(
      locationTitleTarget(location, occurrence, href, '/locations'),
    ).toBeNull();
    state.invalidate();
    expect(state.backTarget(location, href)).toBeNull();
  },
);

it('generic acceptance remains closed until observer registration and clears on observer retirement', () => {
  const state = createRouteMotionState();
  const accept = () =>
    state.acceptArrival(
      '/history',
      '/inventory',
      0,
      'https://inventory.invalid/inventory',
    );
  accept();
  expect(state.arrivalSnapshot()).toBeNull();
  state.supportArrival(true);
  accept();
  expect(state.arrivalSnapshot()).not.toBeNull();
  state.supportArrival(false);
  expect(state.arrivalSnapshot()).toBeNull();
  accept();
  expect(state.arrivalSnapshot()).toBeNull();
});

it('generic arrival requires a fresh accepted navigation and cannot reuse a retired or replaced approval', () => {
  const state = createRouteMotionState();
  state.supportArrival(true);
  expect(state.arrivalSnapshot()).toBeNull();
  state.acceptArrival(
    '/history?category=a&category=b',
    '/inventory?q=cable',
    4,
    'https://inventory.invalid/inventory',
  );
  const first = state.arrivalSnapshot()!;
  expect(first).toEqual({
    name: expect.stringMatching(/^route-primary-/),
    presentation: 'outer',
    sourceKey: '/inventory?q=cable',
    destinationKey: '/history?category=a&category=b',
    epoch: 4,
  });
  state.acceptArrival(
    '/history?category=a&category=b',
    '/inventory?q=cable',
    4,
    'https://inventory.invalid/inventory',
  );
  const repeated = state.arrivalSnapshot();
  expect(repeated).not.toBe(first);
  state.finishArrival(first);
  expect(state.arrivalSnapshot()).toBe(repeated);
  state.finishArrival(repeated!);
  expect(state.arrivalSnapshot()).toBeNull();
  state.acceptArrival(
    '/history',
    '/inventory',
    4,
    'https://inventory.invalid/inventory',
  );
  state.suspend();
  expect(state.arrivalSnapshot()).toBeNull();
  state.acceptArrival(
    '/history',
    '/inventory',
    4,
    'https://inventory.invalid/inventory',
  );
  expect(state.arrivalSnapshot()).toBeNull();
  state.resume();
  state.acceptArrival(
    'https://other.invalid/history',
    '/inventory',
    4,
    'https://inventory.invalid/inventory',
  );
  expect(state.arrivalSnapshot()).toBeNull();
});

it('native arrival retirement preserves the approved title origin for a new application Back event', () => {
  const state = createRouteMotionState();
  state.supportArrival(true);
  const target = titleTarget(record, original, holding)!;
  state.arm(target);
  state.acceptArrival(
    target.detailPath,
    target.listHref,
    1,
    'https://inventory.invalid/inventory',
  );
  state.finishArrival();
  state.finish();
  expect(state.arrivalSnapshot()).toBeNull();
  expect(state.snapshot()).toBeNull();
  expect(state.backTarget(record, original)).toEqual(target);
  state.retire();
  expect(state.backTarget(record, original)).toBeNull();
});

it('observer retirement withdraws active generic/title approval while preserving the approved origin', () => {
  const state = createRouteMotionState();
  state.supportArrival(true);
  const target = titleTarget(record, original, holding)!;
  state.arm(target);
  state.acceptArrival(
    target.detailPath,
    target.listHref,
    1,
    'https://inventory.invalid/inventory',
  );
  state.supportArrival(false);
  expect(state.arrivalSupportSnapshot()).toBe(false);
  expect(state.arrivalSnapshot()).toBeNull();
  expect(state.snapshot()).toBeNull();
  expect(state.backTarget(record, original)).toEqual(target);
  state.supportArrival(true);
  expect(state.arrivalSnapshot()).toBeNull();
  expect(state.snapshot()).toBeNull();
});

it('matches only the canonical or recorded raw results scope for an app pair', () => {
  const target = titleTarget(
    record,
    '/inventory?q=USB#inventory-row-2',
    holding,
    rawAlias,
  )!;
  expect(matchesTitleListRoute(target, rawAlias)).toBe(true);
  expect(matchesTitleListRoute(target, '/inventory?q=USB')).toBe(true);
  expect(matchesTitleListRoute(target, '/inventory?q=USB&status=active')).toBe(
    false,
  );
  expect(matchesTitleListRoute(target, rawAlias + '&unrelated=true')).toBe(
    false,
  );
  const raw = routeKey('/inventory', { q: ['  USB  ', 'opaque'] });
  const repeated = titleTarget(
    record,
    '/inventory?q=USB#inventory-row-2',
    holding,
    raw,
  )!;
  expect(
    matchesTitleListRoute(
      repeated,
      routeKey('/inventory', { q: ['  USB  ', 'different'] }),
    ),
  ).toBe(false);
});

it.each([
  '/settings',
  'https://other.invalid/inventory',
  '/inventory#inventory-row-2',
])('cannot record an unsupported raw source as a list alias (%s)', (raw) => {
  expect(
    titleTarget(record, '/inventory?q=USB#inventory-row-2', holding, raw),
  ).toBeNull();
});

it.each([
  '/inventory?category=a&category=b&q=USB+Cable&type=quantity',
  '/inventory?category=a&category=b&q=USB%20Cable&type=quantity#inventory-row-2',
])(
  'app Back preserves semantic query identity and the separately validated anchor (%s)',
  (destination) => {
    const state = createRouteMotionState();
    const target = titleTarget(record, original, holding)!;
    state.arm(target);
    state.finish();
    expect(state.snapshot()).toBeNull();
    expect(
      state.backTarget(
        record,
        destination + (destination.includes('#') ? '' : '#inventory-row-2'),
      ),
    ).toEqual(target);
  },
);

it.each([
  '/inventory?category=b&category=a&q=USB+Cable&type=quantity',
  '/inventory?category=a&q=USB+Cable&type=quantity',
  '/inventory?category=a&category=b&q=USB+Cable&type=asset',
  '/inventory?category=a&category=b&q=USB+Cable&type=quantity#inventory-row-1',
  '/inventory?category=a&category=b&q=USB+Cable&type=quantity#arbitrary',
  'https://other.invalid/inventory?category=a&category=b&q=USB+Cable&type=quantity',
])(
  'app Back rejects changed filter/repeated-value semantics or an unrelated anchor/origin (%s)',
  (destination) => {
    const state = createRouteMotionState();
    const target = titleTarget(record, original, holding)!;
    state.arm(target);
    state.finish();
    expect(state.backTarget(record, destination)).toBeNull();
  },
);

it('primary capture uses the same exact approval with a unique name across repeated destinations', () => {
  const state = createRouteMotionState();
  state.supportArrival(true);
  state.acceptArrival(
    '/history',
    '/inventory',
    3,
    'https://inventory.invalid/inventory',
    'primary',
  );
  const first = state.arrivalSnapshot()!;
  expect(first).toMatchObject({
    presentation: 'primary',
    name: expect.stringMatching(/^route-primary-/),
  });
  state.acceptArrival(
    '/history',
    '/inventory',
    3,
    'https://inventory.invalid/inventory',
    'primary',
  );
  const next = state.arrivalSnapshot()!;
  expect(next.name).not.toBe(first.name);
  state.finishArrival(first);
  expect(state.arrivalSnapshot()).toBe(next);
});
