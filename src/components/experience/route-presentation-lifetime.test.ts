import { expect, it } from 'vitest';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';

it('transfers a previously captured source after React cleanup to its exact native exit and expires on matching cleanup', () => {
  const store = createRoutePresentationLifetime();
  const source = Symbol();
  const unmount = store.mount(source);
  const exit = store.exitCallback(source);
  let owner = true;
  const ticket = store.capture(
    source,
    () => owner,
    () => true,
  )!;
  expect(Object.isFrozen(ticket)).toBe(true);
  store.navigation();
  owner = false;
  unmount();
  store.mount(Symbol());
  expect(ticket.current()).toBe(false);
  const finish = exit()!;
  expect(ticket.current()).toBe(true);
  finish();
  expect(ticket.current()).toBe(false);
  expect(exit()).toBeUndefined();
});

it.each([
  'finish',
  'rejection',
  'cancellation',
  'navigation',
  'invalidate',
  'release',
] as const)(
  'expires its lease on %s and rejects a later callback from that source',
  (reason) => {
    const store = createRoutePresentationLifetime();
    const source = Symbol();
    const unmount = store.mount(source);
    const exit = store.exitCallback(source);
    const ticket = store.capture(
      source,
      () => true,
      () => true,
    )!;
    store.navigation();
    unmount();
    store.mount(Symbol());
    const finish = exit()!;
    expect(ticket.current()).toBe(true);
    // React calls the exact returned cleanup through finished.finally for
    // success, rejection and cancellation. No animation timer is modeled.
    if (['finish', 'rejection', 'cancellation'].includes(reason)) finish();
    if (reason === 'navigation') store.navigation();
    if (reason === 'invalidate') store.invalidate();
    if (reason === 'release') ticket.release();
    expect(ticket.current()).toBe(false);
    expect(exit()).toBeUndefined();
    finish();
    expect(ticket.current()).toBe(false);
  },
);

it('retirement without a native handoff stays fenced and cannot capture a new denial ticket', () => {
  const store = createRoutePresentationLifetime();
  const source = Symbol();
  const unmount = store.mount(source);
  const exit = store.exitCallback(source);
  let owner = true;
  const ticket = store.capture(
    source,
    () => owner,
    () => true,
  )!;
  owner = false;
  unmount();
  expect(ticket.current()).toBe(false);
  expect(
    store.capture(
      source,
      () => owner,
      () => true,
    ),
  ).toBeUndefined();
  ticket.release();
  expect(exit()).toBeUndefined();
});

it('grant invalidation retires old callbacks while future mounted work gets its own lifetime', () => {
  const store = createRoutePresentationLifetime();
  const source = Symbol();
  const unmount = store.mount(source);
  const exit = store.exitCallback(source);
  let grant = true;
  const old = store.capture(
    source,
    () => true,
    () => grant,
  )!;
  const oldFinish = exit()!;
  grant = false;
  expect(old.current()).toBe(false);
  store.invalidate();
  grant = true;
  const fresh = store.capture(
    source,
    () => true,
    () => grant,
  )!;
  const freshExit = store.exitCallback(source);
  const freshFinish = freshExit()!;
  oldFinish();
  expect(old.current()).toBe(false);
  expect(exit()).toBeUndefined();
  expect(fresh.current()).toBe(true);
  freshFinish();
  expect(fresh.current()).toBe(false);
  unmount();
});

it('rejects callbacks without captured eligibility or under a dead initiating owner/grant', () => {
  const store = createRoutePresentationLifetime();
  const source = Symbol();
  store.mount(source);
  expect(
    store.capture(
      source,
      () => false,
      () => true,
    ),
  ).toBeUndefined();
  expect(
    store.capture(
      source,
      () => true,
      () => false,
    ),
  ).toBeUndefined();
  expect(store.exitCallback(source)()).toBeUndefined();
});

it('a superseding navigation while the original source is still mounted cannot renew its old callback', () => {
  const store = createRoutePresentationLifetime();
  const source = Symbol();
  store.mount(source);
  const oldExit = store.exitCallback(source);
  const old = store.capture(
    source,
    () => true,
    () => true,
  )!;
  store.navigation();
  store.navigation();
  const next = store.capture(
    source,
    () => true,
    () => true,
  )!;
  expect(old.current()).toBe(false);
  expect(oldExit()).toBeUndefined();
  expect(next.current()).toBe(true);
  const nextFinish = store.exitCallback(source)()!;
  nextFinish();
  expect(next.current()).toBe(false);
});

it('only committed immutable descriptors bind; old descriptors cannot borrow a renewed source', () => {
  const store = createRoutePresentationLifetime();
  const source = Symbol();
  store.mount(source);
  const abandoned = Object.freeze({});
  const committed = Object.freeze({});
  expect(store.handoff(abandoned)).toBeUndefined();
  store.bindExit(committed, source);
  const old = store.capture(
    source,
    () => true,
    () => true,
  )!;
  const oldFinish = store.handoff(committed)!;
  store.invalidate();
  const next = store.capture(
    source,
    () => true,
    () => true,
  )!;
  // A repeated layout setup cannot rebind an old native callback to new work.
  store.bindExit(committed, source);
  expect(store.handoff(committed)).toBeUndefined();
  expect(old.current()).toBe(false);
  expect(next.current()).toBe(true);
  const nextDescriptor = Object.freeze({});
  store.bindExit(nextDescriptor, source);
  const nextFinish = store.handoff(nextDescriptor)!;
  oldFinish();
  expect(next.current()).toBe(true);
  nextFinish();
  expect(next.current()).toBe(false);
});
