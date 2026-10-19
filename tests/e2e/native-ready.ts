import type { Page } from '@playwright/test';

export type NativeReadyEvidence = {
  at: number;
  ready: boolean;
  finished: boolean;
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
  cancel: ((error: Error) => void) | null;
  busy: boolean;
};
const dispatchers = new WeakMap<Page, Dispatcher>();

/** Register once per page; validation uses the browser's actual running frame.
 * Keep validation synchronous so a held response can release before any await. */
export async function armNativeReady(
  page: Page,
  validate: (evidence: NativeReadyEvidence) => void,
  run: () => Promise<void>,
) {
  let dispatcher = dispatchers.get(page);
  if (!dispatcher) {
    const registered: Dispatcher = {
      registered: Promise.resolve(),
      run: null,
      cancel: null,
      busy: false,
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
      registered.cancel?.(
        new Error('Page closed before its native-ready operation completed'),
      );
      registered.cancel = null;
      registered.run = null;
      dispatchers.delete(page);
    });
    dispatcher = registered;
  }
  await dispatcher.registered;
  if (dispatcher.busy)
    throw new Error('A native-ready operation is already armed for this page');
  const current = dispatcher;
  current.busy = true;
  const completed = new Promise<void>((resolve, reject) => {
    current.cancel = reject;
    current.run = async (evidence) => {
      try {
        validate(evidence);
        await run();
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        current.cancel = null;
        current.busy = false;
      }
    };
  });
  return { completed };
}
