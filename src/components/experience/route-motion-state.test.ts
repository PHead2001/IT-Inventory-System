import { expect, it } from 'vitest';
import {
  createRouteMotionState,
  titleTarget,
  matchesTitleListRoute,
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

it.each([rawAlias, '/inventory?q=USB', rawAlias + '#inventory-row-2'])(
  'native Back accepts only the canonical scope or recorded raw source (%s)',
  (destination) => {
    const state = createRouteMotionState();
    const target = titleTarget(
      record,
      '/inventory?q=USB#inventory-row-2',
      holding,
      rawAlias,
    )!;
    state.arm(target);
    state.finish();
    state.back(target.detailPath, destination);
    expect(state.snapshot()).toMatchObject(target);
    expect(matchesTitleListRoute(target, rawAlias)).toBe(true);
    expect(matchesTitleListRoute(target, '/inventory?q=USB')).toBe(true);
  },
);

it.each([
  '/inventory?q=USB&status=active', // Equivalent rendered filters, never recorded.
  rawAlias + '&unrelated=true',
  '/inventory?q=Different',
  rawAlias + '#inventory-row-1',
  'https://other.invalid' + rawAlias,
])(
  'native Back does not infer or approve a later alias (%s)',
  (destination) => {
    const state = createRouteMotionState();
    const target = titleTarget(
      record,
      '/inventory?q=USB#inventory-row-2',
      holding,
      rawAlias,
    )!;
    state.arm(target);
    state.finish();
    state.back(target.detailPath, destination);
    expect(state.snapshot()).toBeNull();
  },
);

it('keeps repeated source query values exact and still rejects another record', () => {
  const raw = routeKey('/inventory', { q: ['  USB  ', 'opaque'] });
  const target = titleTarget(
    record,
    '/inventory?q=USB#inventory-row-2',
    holding,
    raw,
  )!;
  const state = createRouteMotionState();
  state.arm(target);
  state.finish();
  state.back(
    target.detailPath,
    routeKey('/inventory', { q: ['  USB  ', 'different'] }),
  );
  expect(state.snapshot()).toBeNull();
  state.back('/inventory/quantity/other', raw);
  expect(state.snapshot()).toBeNull();
  state.back(target.detailPath, raw);
  expect(state.snapshot()).toMatchObject(target);
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
  'browser Back preserves semantic query identity and the separately validated anchor (%s)',
  (destination) => {
    const state = createRouteMotionState();
    const target = titleTarget(record, original, holding)!;
    state.arm(target);
    state.finish();
    state.back(target.detailPath, destination);
    expect(state.snapshot()).toMatchObject({
      ...target,
      anchor: 'inventory-row-2',
    });
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
  'browser Back rejects changed filter/repeated-value semantics or an unrelated anchor/origin (%s)',
  (destination) => {
    const state = createRouteMotionState();
    const target = titleTarget(record, original, holding)!;
    state.arm(target);
    state.finish();
    state.back(target.detailPath, destination);
    expect(state.snapshot()).toBeNull();
  },
);
