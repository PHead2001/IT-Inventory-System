type CaptureListener = (capturing: boolean) => void;

/** Read-only lifecycle hooks inside the one native API observer. The update
 * callback/options, receiver and returned native handle stay untouched. */
export type NativeCaptureObserver = {
  returned(transition: ViewTransition): void;
  failed(): void;
};
export type NativeCaptureHooks = {
  beforeNative(): NativeCaptureObserver | undefined;
};
type CaptureState = {
  listeners: Set<CaptureListener>;
  captures: Set<symbol>;
  hooks: Set<NativeCaptureHooks>;
  original: Document['startViewTransition'];
  wrapped: Document['startViewTransition'];
};
const documents = new WeakMap<Document, CaptureState>();

function reportSubscriberFailure(document: Document) {
  // Subscriber failures must remain visible without logging private values or
  // replacing the native API's return, exception or completion semantics.
  const error = new Error('A transition capture subscriber failed.');
  try {
    if (typeof document.defaultView?.reportError === 'function')
      document.defaultView.reportError(error);
    else console.error(error.message);
  } catch {
    // A user-installed error reporter cannot interrupt another capture owner.
  }
}
function notifySubscriber(
  document: Document,
  listener: CaptureListener,
  capturing: boolean,
  report = true,
) {
  try {
    listener(capturing);
    return true;
  } catch {
    if (report) reportSubscriberFailure(document);
    return false;
  }
}

/** A focus effect retains its intent through capture, and cancels it on cleanup.
 * It neither schedules React work during commit nor changes focus ownership. */
export function afterTransitionCapture(document: Document, effect: () => void) {
  const state = documents.get(document);
  if (!state?.captures.size) {
    effect();
    return () => {};
  }
  const listener: CaptureListener = (capturing) => {
    if (capturing) return;
    state.listeners.delete(listener);
    try {
      effect();
    } finally {
      detachIfIdle(document, state);
    }
  };
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
    detachIfIdle(document, state);
  };
}
function detachIfIdle(document: Document, state: CaptureState) {
  if (state.listeners.size || state.captures.size || state.hooks.size) return;
  // A later observer may wrap ours. Never overwrite its ownership.
  if (document.startViewTransition === state.wrapped) {
    document.startViewTransition = state.original;
    documents.delete(document);
  }
}

/** Native capture temporarily suspends React event dispatch. Do not offer edits
 * until the DOM update settles; animation completion is deliberately irrelevant.
 * This observes the public API without replacing its callback or return value. */
export function observeTransitionCapture(
  document: Document,
  listener: CaptureListener,
  hooks?: NativeCaptureHooks,
) {
  if (typeof document.startViewTransition !== 'function') return () => {};
  let state = documents.get(document);
  if (!state) {
    const original = document.startViewTransition;
    const listeners = new Set<CaptureListener>();
    const captures = new Set<symbol>();
    const nativeHooks = new Set<NativeCaptureHooks>();
    const publish = () => {
      let reported = false;
      for (const notify of listeners)
        if (!notifySubscriber(document, notify, captures.size > 0, !reported))
          reported = true;
    };
    const wrapped: Document['startViewTransition'] = function (
      this: Document,
      ...args
    ) {
      const capture = Symbol();
      captures.add(capture);
      publish();
      const observers: NativeCaptureObserver[] = [];
      for (const hooks of [...nativeHooks]) {
        try {
          const observer = hooks.beforeNative();
          if (observer) observers.push(observer);
        } catch {
          reportSubscriberFailure(document);
        }
      }
      const release = () => {
        if (captures.delete(capture)) publish();
        detachIfIdle(document, state!);
      };
      try {
        const transition = original.apply(this, args);
        for (const observer of observers) {
          try {
            observer.returned(transition);
          } catch {
            reportSubscriberFailure(document);
          }
        }
        void transition.updateCallbackDone.then(release, release);
        return transition;
      } catch (error) {
        for (const observer of observers) {
          try {
            observer.failed();
          } catch {
            reportSubscriberFailure(document);
          }
        }
        release();
        throw error;
      }
    };
    state = { listeners, captures, hooks: nativeHooks, original, wrapped };
    documents.set(document, state);
    document.startViewTransition = wrapped;
  }
  const owned = state;
  owned.listeners.add(listener);
  if (hooks) owned.hooks.add(hooks);
  notifySubscriber(document, listener, owned.captures.size > 0);
  return () => {
    owned.listeners.delete(listener);
    if (hooks) owned.hooks.delete(hooks);
    detachIfIdle(document, owned);
  };
}
