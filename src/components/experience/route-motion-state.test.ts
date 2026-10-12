import { expect, it } from 'vitest';
import { createRouteMotionState, titleTarget } from './route-motion-state';

const record = { kind: 'quantity' as const, id: 'quantity' };
const holding = { domain: 'storage' as const, id: 'storage' };
const original =
  '/inventory?type=quantity&q=USB%20Cable&category=a&category=b#inventory-row-2';

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
