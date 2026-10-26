import { afterEach, expect, it, vi } from 'vitest';
import {
  armNativeReady,
  cancelNativeReady,
  nativeReadyDiagnostic,
  NATIVE_READY_TIMEOUT_MS,
  type NativeReadyEvidence,
} from '../e2e/native-ready';

const evidence: NativeReadyEvidence = {
  at: 500,
  ready: true,
  finished: false,
  effects: [],
};
afterEach(() => vi.useRealTimers());
function fixture() {
  let ready:
    ((_source: unknown, proof: typeof evidence) => Promise<void>) | undefined;
  let close: (() => void) | undefined;
  const page = {
    exposeBinding: vi.fn(
      async (_name: string, callback: NonNullable<typeof ready>) => {
        if (ready) throw new Error('binding already registered');
        ready = callback;
      },
    ),
    once: vi.fn((_event: string, callback: () => void) => {
      close = callback;
    }),
  };
  return {
    page: page as never,
    expose: page.exposeBinding,
    closeListener: page.once,
    ready: (proof: NativeReadyEvidence = evidence) => ready!({}, proof),
    close: () => close!(),
  };
}

it('rearms the same page twice with one binding and a fresh validation for each native-ready event', async () => {
  const f = fixture(),
    validate = vi.fn(() => {}),
    run = vi.fn(async () => {});
  for (let i = 0; i < 2; i++) {
    const { completed } = await armNativeReady(f.page, validate, run);
    await f.ready();
    await completed;
    await f.ready();
  }
  expect(f.expose).toHaveBeenCalledTimes(1);
  expect(f.closeListener).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(2);
});

it('terminal completion before an owned running frame rejects promptly without releasing the held operation', async () => {
  const f = fixture(),
    validate = vi.fn(),
    release = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, validate, release);
  const rejected = expect(completed).rejects.toThrow('finished-before-running');
  await f.ready({
    ...evidence,
    finished: true,
    terminal: 'finished-before-running',
  });
  await rejected;
  expect(validate).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  const next = await armNativeReady(f.page, validate, release);
  await f.ready();
  await next.completed;
  expect(release).toHaveBeenCalledOnce();
});

it('rejects an overlapping arm without losing the original ready barrier', async () => {
  const f = fixture(),
    run = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, () => {}, run);
  await expect(armNativeReady(f.page, () => {}, run)).rejects.toThrow(
    'already armed',
  );
  await f.ready();
  await completed;
  expect(run).toHaveBeenCalledTimes(1);
});

it('a failed actual-animation validation rejects the wait and never performs the operation', async () => {
  const f = fixture(),
    run = vi.fn(async () => {});
  const { completed } = await armNativeReady(
    f.page,
    () => {
      throw new Error('no running native snapshot');
    },
    run,
  );
  const result = expect(completed).rejects.toThrow(
    'no running native snapshot',
  );
  await f.ready();
  await result;
  expect(run).not.toHaveBeenCalled();
});

it('page closure rejects and retires the pending operation', async () => {
  const f = fixture(),
    run = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, () => {}, run);
  const result = expect(completed).rejects.toThrow('Page closed');
  f.close();
  await result;
  await f.ready();
  expect(run).not.toHaveBeenCalled();
});

it('validates browser evidence and releases the operation before yielding for another browser round trip', async () => {
  const f = fixture(),
    validate = vi.fn(() => {}),
    release = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, validate, release);
  const dispatched = f.ready();
  expect(validate).toHaveBeenCalledExactlyOnceWith(evidence);
  expect(release).toHaveBeenCalledOnce();
  await dispatched;
  await completed;
});

it('bounds a missing running-frame notification and never dispatches its late operation', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const run = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, () => {}, run);
  let failure: unknown;
  void completed.catch((error: unknown) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(NATIVE_READY_TIMEOUT_MS);
  expect(failure).toEqual(
    new Error('NATIVE_READY_TIMEOUT_WAITING_RUNNING_FRAME'),
  );
  expect(nativeReadyDiagnostic(f.page)).toEqual({
    stage: 'WAITING_RUNNING_FRAME',
    failure: 'NATIVE_READY_TIMEOUT_WAITING_RUNNING_FRAME',
  });
  await f.ready();
  expect(run).not.toHaveBeenCalled();
  await expect(armNativeReady(f.page, () => {}, run)).rejects.toThrow(
    'retired',
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('includes binding registration in the same overall deadline and handles a late registration failure', async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const f = fixture();
  f.expose.mockImplementationOnce(
    () =>
      new Promise<void>((_yes, no) => {
        reject = no;
      }),
  );
  const run = vi.fn(async () => {});
  const armed = armNativeReady(f.page, () => {}, run);
  const failure = expect(armed).rejects.toThrow(
    'NATIVE_READY_TIMEOUT_BINDING_REGISTRATION',
  );
  await vi.advanceTimersByTimeAsync(NATIVE_READY_TIMEOUT_MS);
  await failure;
  expect(nativeReadyDiagnostic(f.page)).toEqual({
    stage: 'BINDING_REGISTRATION',
    failure: 'NATIVE_READY_TIMEOUT_BINDING_REGISTRATION',
  });
  reject(new Error('late binding failure'));
  await Promise.resolve();
  expect(run).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not restart the deadline after a slow successful registration', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const expose = f.expose.getMockImplementation()!;
  let registered!: () => void;
  f.expose.mockImplementationOnce(async (...args) => {
    await new Promise<void>((yes) => {
      registered = yes;
    });
    await expose(...args);
  });
  const armed = armNativeReady(
    f.page,
    () => {},
    async () => {},
  );
  await vi.advanceTimersByTimeAsync(4_000);
  registered();
  const { completed } = await armed;
  const rejected = expect(completed).rejects.toThrow(
    'NATIVE_READY_TIMEOUT_WAITING_RUNNING_FRAME',
  );
  await vi.advanceTimersByTimeAsync(6_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it('retains a binding registration error while exposing only its fixed failure code', async () => {
  const f = fixture();
  const original = new Error('binding rejected');
  f.expose.mockRejectedValueOnce(original);
  await expect(
    armNativeReady(
      f.page,
      () => {},
      async () => {},
    ),
  ).rejects.toBe(original);
  expect(nativeReadyDiagnostic(f.page)).toEqual({
    stage: 'BINDING_REGISTRATION',
    failure: 'NATIVE_READY_BINDING_FAILED',
  });
});

it('clears a successful operation deadline and cannot time out a newly armed waiter with its old timer', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const first = await armNativeReady(
    f.page,
    () => {},
    async () => {},
  );
  await vi.advanceTimersByTimeAsync(9_000);
  await f.ready();
  await first.completed;
  expect(vi.getTimerCount()).toBe(0);
  const second = await armNativeReady(
    f.page,
    () => {},
    async () => {},
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(nativeReadyDiagnostic(f.page)).toEqual({
    stage: 'WAITING_RUNNING_FRAME',
    failure: null,
  });
  await f.ready();
  await second.completed;
  expect(vi.getTimerCount()).toBe(0);
  expect(f.expose).toHaveBeenCalledOnce();
});

it('explicit test cleanup retires only the waiter and ignores later frame delivery', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const run = vi.fn(async () => {});
  const { completed } = await armNativeReady(f.page, () => {}, run);
  const rejected = expect(completed).rejects.toThrow('NATIVE_READY_CANCELLED');
  cancelNativeReady(f.page);
  cancelNativeReady(f.page);
  await rejected;
  await f.ready();
  expect(run).not.toHaveBeenCalled();
  expect(nativeReadyDiagnostic(f.page)).toEqual({
    stage: 'WAITING_RUNNING_FRAME',
    failure: 'NATIVE_READY_CANCELLED',
  });
  await expect(armNativeReady(f.page, () => {}, run)).rejects.toThrow(
    'retired',
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('handles timeout rejection even when an earlier click failure prevents awaiting completed', async () => {
  vi.useFakeTimers();
  const f = fixture();
  // Deliberately never attach a caller rejection handler. Vitest reports any
  // unhandled rejection; the returned rejected promise must still be observable.
  const armed = await armNativeReady(
    f.page,
    () => {},
    async () => {},
  );
  await vi.advanceTimersByTimeAsync(NATIVE_READY_TIMEOUT_MS);
  await expect(armed.completed).rejects.toThrow(
    'NATIVE_READY_TIMEOUT_WAITING_RUNNING_FRAME',
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves original callback failure and returns an independent fixed diagnostic snapshot', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const original = new Error('operation rejected');
  const { completed } = await armNativeReady(
    f.page,
    () => {},
    async () => {
      throw original;
    },
  );
  const rejected = expect(completed).rejects.toBe(original);
  await f.ready();
  await rejected;
  const diagnostic = nativeReadyDiagnostic(f.page)!;
  expect(diagnostic).toEqual({
    stage: 'CALLBACK_SETTLEMENT',
    failure: 'NATIVE_READY_CALLBACK_REJECTED',
  });
  const callerRecord: Record<string, unknown> = diagnostic;
  callerRecord.failure = 'caller mutation';
  expect(nativeReadyDiagnostic(f.page)?.failure).toBe(
    'NATIVE_READY_CALLBACK_REJECTED',
  );
  expect(vi.getTimerCount()).toBe(0);
});

it('page closure during dispatched work retains its failure after that work later settles', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: () => void;
  const { completed } = await armNativeReady(
    f.page,
    () => {},
    () =>
      new Promise<void>((yes) => {
        finish = yes;
      }),
  );
  const delivered = f.ready();
  const rejected = expect(completed).rejects.toThrow(
    'NATIVE_READY_PAGE_CLOSED',
  );
  f.close();
  await rejected;
  finish();
  await delivered;
  expect(nativeReadyDiagnostic(f.page)).toEqual({
    stage: 'CALLBACK_SETTLEMENT',
    failure: 'NATIVE_READY_PAGE_CLOSED',
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds callback settlement and handles a later rejection without changing its timeout result', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let reject!: (error: Error) => void;
  const work = new Promise<void>((_resolve, no) => {
    reject = no;
  });
  const { completed } = await armNativeReady(
    f.page,
    () => {},
    () => work,
  );
  let failure: unknown;
  void completed.catch((error: unknown) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(2_000);
  const delivered = f.ready();
  await vi.advanceTimersByTimeAsync(8_000);
  expect(failure).toEqual(
    new Error('NATIVE_READY_TIMEOUT_CALLBACK_SETTLEMENT'),
  );
  reject(new Error('late callback rejection'));
  await delivered;
  expect(failure).toEqual(
    new Error('NATIVE_READY_TIMEOUT_CALLBACK_SETTLEMENT'),
  );
  expect(vi.getTimerCount()).toBe(0);
});
