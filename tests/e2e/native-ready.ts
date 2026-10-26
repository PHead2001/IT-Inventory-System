import type { Page } from '@playwright/test';

export type NativeReadyEvidence = {
  at: number;
  ready: boolean;
  finished: boolean;
  terminal?: 'finished-before-running' | 'ready-rejected' | 'finished-rejected';
  firstSkip?: {
    at: number;
    reason: 'skip-transition';
    caller: string[];
    geometry: Array<{
      pseudo: string;
      width: boolean;
      height: boolean;
      transform: 'missing' | 'identity' | 'other';
    }>;
  };
  effects: Array<{
    pseudo: string;
    playState: AnimationPlayState;
    startTime: number | null;
    currentTime: number | null;
    activeDuration: number;
    endTime: number;
    progress: number | null;
  }>;
};

type Dispatcher = {
  registered: Promise<void>;
  run: ((evidence: NativeReadyEvidence) => Promise<void>) | null;
  cancel: ((error: unknown, code: NativeReadyFailure) => void) | null;
  active: symbol | null;
  retired: boolean;
  diagnostic: { stage: NativeReadyStage; failure: NativeReadyFailure | null };
};
type NativeReadyStage =
  | 'BINDING_REGISTRATION'
  | 'WAITING_RUNNING_FRAME'
  | 'FRAME_VALIDATION'
  | 'CALLBACK_SETTLEMENT'
  | 'COMPLETE';
type NativeReadyFailure =
  | `NATIVE_READY_TIMEOUT_${NativeReadyStage}`
  | 'NATIVE_READY_BINDING_FAILED'
  | 'NATIVE_READY_CANCELLED'
  | 'NATIVE_READY_PAGE_CLOSED'
  | 'NATIVE_READY_FRAME_REJECTED'
  | 'NATIVE_READY_CALLBACK_REJECTED';
// One overall deadline, including registration and the real operation, leaves
// room for the ordinary 30s test's setup and failure hooks. It never retimes the
// native animation or supplies a synthetic running frame.
export const NATIVE_READY_TIMEOUT_MS = 10_000;
const dispatchers = new WeakMap<Page, Dispatcher>();

export function nativeReadyDiagnostic(page: Page) {
  const diagnostic = dispatchers.get(page)?.diagnostic;
  return diagnostic ? { ...diagnostic } : null;
}

/** Retire only this test's waiter, never the native transition or dispatched work. */
export function cancelNativeReady(page: Page) {
  dispatchers
    .get(page)
    ?.cancel?.(new Error('NATIVE_READY_CANCELLED'), 'NATIVE_READY_CANCELLED');
}

/** Register once per page; validation uses the browser's actual running frame.
 * Keep validation synchronous so a held response can release before any await. */
export async function armNativeReady(
  page: Page,
  validate: (evidence: NativeReadyEvidence) => void,
  run: () => Promise<void>,
) {
  const deadline = Date.now() + NATIVE_READY_TIMEOUT_MS;
  let dispatcher = dispatchers.get(page);
  if (!dispatcher) {
    const registered: Dispatcher = {
      registered: Promise.resolve(),
      run: null,
      cancel: null,
      active: null,
      retired: false,
      diagnostic: { stage: 'BINDING_REGISTRATION', failure: null },
    };
    dispatchers.set(page, registered);
    registered.registered = page
      .exposeBinding(
        'routeMotionReady',
        async (_source, evidence: NativeReadyEvidence) => {
          const next = registered.run;
          registered.run = null;
          await next?.(evidence);
        },
      )
      .then(() => {});
    page.once('close', () => {
      registered.retired = true;
      registered.cancel?.(
        new Error('Page closed: NATIVE_READY_PAGE_CLOSED'),
        'NATIVE_READY_PAGE_CLOSED',
      );
      registered.cancel = null;
      registered.run = null;
    });
    dispatcher = registered;
  }
  if (dispatcher.retired)
    throw new Error('Native-ready dispatcher retired for this page');
  if (dispatcher.active)
    throw new Error('A native-ready operation is already armed for this page');
  const current = dispatcher;
  const operation = Symbol();
  current.active = operation;
  current.diagnostic = { stage: 'BINDING_REGISTRATION', failure: null };
  const completed = new Promise<void>((resolve, reject) => {
    const diagnostic = current.diagnostic;
    const cleanup = () => {
      clearTimeout(timer);
      if (current.active !== operation) return;
      current.active = null;
      current.cancel = null;
      current.run = null;
    };
    const fail = (error: unknown, code: NativeReadyFailure, retire = false) => {
      if (current.active !== operation) return;
      diagnostic.failure = code;
      current.retired ||= retire;
      cleanup();
      reject(error);
    };
    const timer = setTimeout(
      () => {
        const code = `NATIVE_READY_TIMEOUT_${diagnostic.stage}` as const;
        fail(new Error(code), code, true);
      },
      Math.max(0, deadline - Date.now()),
    );
    current.cancel = (error, code) => fail(error, code, true);
    current.run = async (evidence) => {
      if (current.active !== operation) return;
      try {
        diagnostic.stage = 'FRAME_VALIDATION';
        if (evidence.terminal)
          throw new Error(
            'Native snapshot ' +
              evidence.terminal +
              ': ' +
              JSON.stringify(evidence),
          );
        validate(evidence);
        diagnostic.stage = 'CALLBACK_SETTLEMENT';
        await run();
        if (current.active !== operation) return;
        diagnostic.stage = 'COMPLETE';
        cleanup();
        resolve();
      } catch (error) {
        fail(
          error,
          diagnostic.stage === 'FRAME_VALIDATION'
            ? 'NATIVE_READY_FRAME_REJECTED'
            : 'NATIVE_READY_CALLBACK_REJECTED',
        );
      }
    };
  });
  // The caller can still await and receive the original rejection. Observe it
  // immediately as a click/assertion may fail before it reaches that await.
  void completed.catch(() => {});
  try {
    await Promise.race([current.registered, completed]);
  } catch (error) {
    if (current.active === operation) {
      current.retired = true;
      current.cancel?.(error, 'NATIVE_READY_BINDING_FAILED');
    }
    throw error;
  }
  if (current.active === operation)
    current.diagnostic.stage = 'WAITING_RUNNING_FRAME';
  return { completed };
}
