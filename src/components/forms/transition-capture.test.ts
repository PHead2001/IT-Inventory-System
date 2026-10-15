import { afterEach, expect, it, vi } from 'vitest';
import {
  afterTransitionCapture,
  observeTransitionCapture,
} from './transition-capture';

const original = document.startViewTransition;
afterEach(() => {
  document.startViewTransition = original;
  vi.unstubAllGlobals();
});
it('isolates throwing subscribers and deferred effects while retaining native API and other gates', async () => {
  const update = deferred();
  const native = vi
    .fn()
    .mockReturnValue({ updateCallbackDone: update.promise });
  document.startViewTransition = native;
  const reported = vi.fn();
  vi.stubGlobal('reportError', reported);
  const throwing = observeTransitionCapture(document, (capturing) => {
    if (capturing) throw new Error('private focus failure');
  });
  const observed = vi.fn();
  const dispose = observeTransitionCapture(document, observed);
  expect(() => document.startViewTransition()).not.toThrow();
  expect(native).toHaveBeenCalledOnce();
  afterTransitionCapture(document, () => {
    throw new Error('private deferred focus failure');
  });
  const later = vi.fn();
  afterTransitionCapture(document, later);
  update.resolve();
  await update.promise;
  expect(observed).toHaveBeenLastCalledWith(false);
  expect(later).toHaveBeenCalledOnce();
  expect(reported).toHaveBeenCalled();
  for (const [error] of reported.mock.calls)
    expect(String(error)).not.toContain('private');
  throwing();
  dispose();
  expect(document.startViewTransition).toBe(native);
});
it('preserves a native thrown error even when release subscribers and error reporting throw', () => {
  const nativeError = new Error('native API failure');
  const native = vi.fn(() => {
    throw nativeError;
  });
  document.startViewTransition = native;
  vi.stubGlobal('reportError', () => {
    throw new Error('reporting failure');
  });
  const dispose = observeTransitionCapture(document, () => {
    throw new Error('subscriber failure');
  });
  const observed = vi.fn();
  const later = observeTransitionCapture(document, observed);
  expect(() => document.startViewTransition()).toThrow(nativeError);
  expect(native).toHaveBeenCalledOnce();
  expect(observed.mock.calls.map(([value]) => value)).toEqual([
    false,
    true,
    false,
  ]);
  dispose();
  later();
  expect(document.startViewTransition).toBe(native);
});
function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('defers focus intents until capture release and cancels stale effect ownership', async () => {
  const update = deferred();
  document.startViewTransition = vi
    .fn()
    .mockReturnValue({ updateCallbackDone: update.promise });
  const release = observeTransitionCapture(document, vi.fn());
  const immediate = vi.fn();
  afterTransitionCapture(document, immediate)();
  expect(immediate).toHaveBeenCalledOnce();
  document.startViewTransition();
  const stale = vi.fn();
  const current = vi.fn();
  const cancel = afterTransitionCapture(document, stale);
  afterTransitionCapture(document, current);
  cancel();
  expect(current).not.toHaveBeenCalled();
  update.resolve();
  await update.promise;
  expect(stale).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledOnce();
  release();
});
it('preserves receiver, callback/options, identity, errors and releases before animation completion', async () => {
  const update = deferred();
  const finished = deferred();
  const transition = {
    updateCallbackDone: update.promise,
    finished: finished.promise,
  } as ViewTransition;
  const native = vi.fn(function (this: Document) {
    expect(this).toBe(document);
    return transition;
  });
  document.startViewTransition = native;
  const listener = vi.fn();
  const dispose = observeTransitionCapture(document, listener);
  const options = { update: vi.fn(), types: ['route'] };
  expect(document.startViewTransition(options)).toBe(transition);
  expect(native).toHaveBeenCalledWith(options);
  expect(listener.mock.calls.map(([v]) => v)).toEqual([false, true]);
  const callback = vi.fn();
  expect(document.startViewTransition(callback)).toBe(transition);
  expect(native).toHaveBeenLastCalledWith(callback);
  update.resolve();
  await update.promise;
  expect(listener).toHaveBeenLastCalledWith(false);
  dispose();
  expect(document.startViewTransition).toBe(native);
  const error = new Error('native failure');
  document.startViewTransition = () => {
    throw error;
  };
  const release = observeTransitionCapture(document, listener);
  expect(() => document.startViewTransition()).toThrow(error);
  expect(listener).toHaveBeenLastCalledWith(false);
  release();
});
it('retains overlapping captures across teardown/remount and releases rejected/skipped updates by owner', async () => {
  const first = deferred();
  const second = deferred();
  const native = vi
    .fn()
    .mockReturnValueOnce({ updateCallbackDone: first.promise })
    .mockReturnValueOnce({ updateCallbackDone: second.promise });
  document.startViewTransition = native;
  const dispose = observeTransitionCapture(document, vi.fn());
  document.startViewTransition();
  const wrapped = document.startViewTransition;
  dispose();
  expect(document.startViewTransition).toBe(wrapped);
  const listener = vi.fn();
  const release = observeTransitionCapture(document, listener);
  expect(listener).toHaveBeenLastCalledWith(true);
  document.startViewTransition();
  first.reject();
  await first.promise.catch(() => {});
  expect(listener).toHaveBeenLastCalledWith(true);
  second.resolve();
  await second.promise;
  expect(listener).toHaveBeenLastCalledWith(false);
  release();
  expect(document.startViewTransition).toBe(native);
});
it('runs typed hooks before native capture and returns the exact handle without wrapping update or extending edit suspension', async () => {
  const update = deferred(),
    ready = deferred(),
    finished = deferred();
  const handle = {
    updateCallbackDone: update.promise,
    ready: ready.promise,
    finished: finished.promise,
  } as ViewTransition;
  const events: string[] = [];
  const options = { update: vi.fn(), types: ['route'] };
  document.startViewTransition = vi.fn(function (this: Document, received) {
    expect(this).toBe(document);
    expect(received).toBe(options);
    events.push('native');
    return handle;
  });
  const listener = vi.fn();
  const dispose = observeTransitionCapture(document, listener, {
    beforeNative: () => {
      events.push('before');
      return {
        returned: (received) => {
          expect(received).toBe(handle);
          events.push('returned');
        },
        failed: vi.fn(),
      };
    },
  });
  expect(document.startViewTransition(options)).toBe(handle);
  expect(events).toEqual(['before', 'native', 'returned']);
  expect(options.update).not.toHaveBeenCalled();
  update.resolve();
  await update.promise;
  expect(listener).toHaveBeenLastCalledWith(false);
  dispose();
  ready.resolve();
  finished.resolve();
});

it('keeps hook failures separate from native return/exception identity and retires hooks with their observer', async () => {
  const update = deferred();
  const nativeError = new TypeError('original native exception');
  const handle = { updateCallbackDone: update.promise } as ViewTransition;
  const native = vi
    .fn()
    .mockReturnValueOnce(handle)
    .mockImplementationOnce(() => {
      throw nativeError;
    });
  document.startViewTransition = native;
  const reported = vi.fn();
  vi.stubGlobal('reportError', reported);
  const failed = vi.fn(() => {
    throw new Error('private hook');
  });
  const before = vi.fn(() => ({
    returned: () => {
      throw new Error('private hook');
    },
    failed,
  }));
  const dispose = observeTransitionCapture(document, vi.fn(), {
    beforeNative: before,
  });
  const throwing = observeTransitionCapture(document, vi.fn(), {
    beforeNative: () => {
      throw new Error('private hook');
    },
  });
  expect(document.startViewTransition()).toBe(handle);
  expect(() => document.startViewTransition()).toThrow(nativeError);
  expect(failed).toHaveBeenCalledOnce();
  expect(reported).toHaveBeenCalled();
  dispose();
  throwing();
  update.resolve();
  await update.promise;
});

it('leaves unsupported browsers and newer API wrappers alone', () => {
  document.startViewTransition =
    undefined as unknown as Document['startViewTransition'];
  const listener = vi.fn();
  observeTransitionCapture(document, listener)();
  expect(listener).not.toHaveBeenCalled();
  const native = vi.fn();
  document.startViewTransition = native;
  const dispose = observeTransitionCapture(document, listener);
  const replacement = vi.fn();
  document.startViewTransition = replacement;
  dispose();
  expect(document.startViewTransition).toBe(replacement);
});
