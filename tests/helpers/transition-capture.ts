import { observeTransitionCapture } from '../../src/components/forms/transition-capture';

/** Hold DOM capture independently of the native animation completion. */
export function holdTransitionCapture(start = true) {
  const original = Object.getOwnPropertyDescriptor(
    document,
    'startViewTransition',
  );
  let release!: () => void;
  const updateCallbackDone = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: () => ({
      updateCallbackDone,
      ready: new Promise(() => {}),
      finished: new Promise(() => {}),
      skipTransition() {},
    }),
  });
  const stop = observeTransitionCapture(document, () => {});
  const begin = () => document.startViewTransition(() => {});
  if (start) begin();
  return {
    begin,
    async release() {
      release();
      await updateCallbackDone;
    },
    dispose() {
      stop();
      if (original)
        Object.defineProperty(document, 'startViewTransition', original);
      else Reflect.deleteProperty(document, 'startViewTransition');
    },
  };
}
