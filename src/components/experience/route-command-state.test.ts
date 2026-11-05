import { expect, it, vi } from 'vitest';
import { createRouteCommandState } from './route-command-state';
it('retires authority synchronously but coalesces deferred subscriber publication', () => {
  const state = createRouteCommandState();
  const notify = vi.fn();
  state.subscribe(notify);
  state.retire(false);
  state.retire(false);
  expect(state.snapshot().generation).toBe(2);
  expect(notify).not.toHaveBeenCalled();
  state.publish();
  expect(notify).toHaveBeenCalledTimes(1);
  state.publish();
  expect(notify).toHaveBeenCalledTimes(1);
  state.retire();
  expect(notify).toHaveBeenCalledTimes(2);
  state.retire(false);
  state.navigation('/inventory');
  expect(notify).toHaveBeenCalledTimes(3);
  state.publish();
  expect(notify).toHaveBeenCalledTimes(3);
});

it('publishes navigation origin atomically with its existing identity and leaves retire/publication unchanged', () => {
  const state = createRouteCommandState();
  expect(state.navigationOrigin()).toBe('initial');
  expect(state.navigationIdentity()).toBe(0);
  const observed: {
    origin: string;
    identity: number;
    destination: string | null;
  }[] = [];
  state.subscribe(() =>
    observed.push({
      origin: state.navigationOrigin(),
      identity: state.navigationIdentity(),
      destination: state.navigationDestination(),
    }),
  );
  state.navigation('/inventory/assets/record');
  state.history('/inventory/assets/record');
  state.retire(false);
  state.publish();
  state.navigation('/inventory/assets/record');
  expect(observed).toEqual([
    {
      origin: 'application',
      identity: 1,
      destination: '/inventory/assets/record',
    },
    { origin: 'history', identity: 2, destination: '/inventory/assets/record' },
    { origin: 'history', identity: 2, destination: '/inventory/assets/record' },
    {
      origin: 'application',
      identity: 3,
      destination: '/inventory/assets/record',
    },
  ]);
});
