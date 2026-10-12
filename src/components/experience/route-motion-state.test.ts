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
