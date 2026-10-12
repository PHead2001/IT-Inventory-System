import { expect, it, vi } from 'vitest';
import {
  createNativeRouteTraverse,
  type NativeTraverseCapture,
} from './native-route-traverse';

function fixture() {
  let href = 'https://inventory.example/inventory/quantity/cable';
  let key = 'detail-entry';
  let epoch = 1;
  const captures: NativeTraverseCapture[] = [];
  const preparations: Array<{
    cancel: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
  }> = [];
  const prepare = vi.fn((capture: NativeTraverseCapture) => {
    captures.push(capture);
    const ownEpoch = ++epoch;
    const value = {
      epoch: ownEpoch,
      identity: Symbol(),
      current: () => epoch === ownEpoch,
      cancel: vi.fn(),
      history: vi.fn(),
    };
    preparations.push(value);
    return value;
  });
  const observer = createNativeRouteTraverse({
    provider: Symbol(),
    source: () => '/inventory/quantity/cable',
    sourceRouteKey: () => '/inventory/quantity/cable?returnTo=exact',
    origin: 'https://inventory.example',
    href: () => href,
    entryKey: () => key,
    prepare,
  });
  const event = (
    destinationKey = 'list-entry',
    url = 'https://inventory.example/inventory?z=2&a=1#inventory-row-2',
    navigationType: NavigationType = 'traverse',
  ) => {
    const controller = new AbortController();
    return {
      controller,
      value: {
        isTrusted: true,
        navigationType,
        signal: controller.signal,
        destination: {
          key: destinationKey,
          url,
          sameDocument: true,
          id: destinationKey,
          index: 1,
          getState: () => undefined,
        },
      },
    };
  };
  return {
    observer,
    prepare,
    captures,
    preparations,
    event,
    invalidateEpoch() {
      epoch++;
    },
    commit(destinationKey: string, url: string) {
      key = destinationKey;
      href = url;
      observer.committed();
    },
  };
}

it('captures exact raw URL/hash and entry key before commit, then consumes history only once', () => {
  const f = fixture();
  const back = f.event();
  f.observer.navigate(back.value);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.captures[0]).toMatchObject({
    source: '/inventory/quantity/cable',
    sourceRouteKey: '/inventory/quantity/cable?returnTo=exact',
    destinationEntryKey: 'list-entry',
    destinationHref: back.value.destination.url,
    destinationRelativeHref: '/inventory?z=2&a=1#inventory-row-2',
    destinationRouteKey: '/inventory?a=1&z=2',
  });
  expect(Object.isFrozen(f.captures[0])).toBe(true);
  expect(f.preparations[0].history).not.toHaveBeenCalled();
  f.commit('list-entry', back.value.destination.url);
  expect(f.observer.pop()).toBe(true);
  expect(f.observer.pop()).toBe(true);
  expect(f.preparations[0].history).toHaveBeenCalledOnce();
  expect(f.preparations[0].cancel).not.toHaveBeenCalled();
});

it('preserves committed traversal through Next same-entry replace and late abort', () => {
  const f = fixture();
  const back = f.event();
  f.observer.navigate(back.value);
  f.commit('list-entry', back.value.destination.url);
  back.controller.abort();
  f.observer.navigate(
    f.event('next-replacement-key', back.value.destination.url, 'replace')
      .value,
  );
  f.commit('list-entry', back.value.destination.url);
  expect(f.observer.pop()).toBe(true);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.preparations[0].cancel).not.toHaveBeenCalled();
});

it('retires an aborted precommit preparation and leaves canonical pop fallback available', () => {
  const f = fixture();
  const back = f.event();
  f.observer.navigate(back.value);
  back.controller.abort();
  expect(f.preparations[0].cancel).toHaveBeenCalledOnce();
  f.commit('list-entry', back.value.destination.url);
  expect(f.observer.pop()).toBe(false);
  expect(f.preparations[0].history).not.toHaveBeenCalled();
});

it('rapid Back/Forward and duplicate URLs with different entry keys never borrow an older preparation', () => {
  const f = fixture();
  const back = f.event('list-one');
  const forward = f.event('list-two', back.value.destination.url);
  f.observer.navigate(back.value);
  f.observer.navigate(forward.value);
  back.controller.abort();
  expect(f.preparations[0].cancel).toHaveBeenCalledOnce();
  expect(f.preparations[1].cancel).not.toHaveBeenCalled();
  f.commit('list-two', forward.value.destination.url);
  expect(f.observer.pop()).toBe(true);
  expect(f.preparations[0].history).not.toHaveBeenCalled();
  expect(f.preparations[1].history).toHaveBeenCalledOnce();
});

it.each(['key', 'raw query', 'hash'])(
  'a committed %s mismatch cannot acknowledge the candidate',
  (mismatch) => {
    const f = fixture();
    const back = f.event();
    f.observer.navigate(back.value);
    f.commit(
      mismatch === 'key' ? 'same-url-other-entry' : 'list-entry',
      mismatch === 'raw query'
        ? 'https://inventory.example/inventory?a=1&z=2#inventory-row-2'
        : mismatch === 'hash'
          ? 'https://inventory.example/inventory?z=2&a=1#inventory-row-3'
          : back.value.destination.url,
    );
    expect(f.observer.pop()).toBe(false);
    expect(f.preparations[0].cancel).toHaveBeenCalledOnce();
    expect(f.preparations[0].history).not.toHaveBeenCalled();
  },
);

it.each(['synthetic', 'cross origin', 'cross document', 'push', 'aborted'])(
  'ignores %s navigation without preparing or controlling it',
  (kind) => {
    const f = fixture();
    const back = f.event();
    if (kind === 'synthetic') back.value.isTrusted = false;
    if (kind === 'cross origin')
      back.value.destination.url = 'https://elsewhere.example/inventory';
    if (kind === 'cross document') back.value.destination.sameDocument = false;
    if (kind === 'push') back.value.navigationType = 'push';
    if (kind === 'aborted') back.controller.abort();
    f.observer.navigate(back.value);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.observer.pop()).toBe(false);
  },
);

it('quiet provider/revocation retirement detaches stale aborts without canceling newer owners', () => {
  const f = fixture();
  const back = f.event();
  f.observer.navigate(back.value);
  f.observer.clear(false);
  const next = f.event('another-entry');
  f.observer.navigate(next.value);
  back.controller.abort();
  expect(f.preparations[0].cancel).not.toHaveBeenCalled();
  expect(f.preparations[1].cancel).not.toHaveBeenCalled();
  f.commit('another-entry', next.value.destination.url);
  expect(f.observer.pop()).toBe(true);
});

it('a stale pending epoch cannot cancel or acknowledge a newer preparation', () => {
  const f = fixture();
  const back = f.event();
  f.observer.navigate(back.value);
  f.invalidateEpoch();
  back.controller.abort();
  expect(f.preparations[0].cancel).not.toHaveBeenCalled();
  expect(f.preparations[0].history).not.toHaveBeenCalled();
  const next = f.event('new-entry');
  f.observer.navigate(next.value);
  f.commit('new-entry', next.value.destination.url);
  expect(f.observer.pop()).toBe(true);
  expect(f.preparations[1].history).toHaveBeenCalledOnce();
});

it('rejects a preparation already stale when prepare returns without installing a candidate', () => {
  const f = fixture();
  const back = f.event();
  const cancel = vi.fn();
  const history = vi.fn();
  f.prepare.mockReturnValueOnce({
    epoch: 0,
    identity: Symbol(),
    current: () => false,
    cancel,
    history,
  });
  const subscribeAbort = vi.spyOn(back.value.signal, 'addEventListener');
  f.observer.navigate(back.value);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(subscribeAbort).not.toHaveBeenCalled();
  f.commit('list-entry', back.value.destination.url);
  expect(f.observer.pop()).toBe(false);
  back.controller.abort();
  expect(cancel).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
});
