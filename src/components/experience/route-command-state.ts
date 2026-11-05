/** Provider-local navigation identity. No private content, DOM or credentials. */
export function createRouteCommandState() {
  let serial = 0;
  let generation = 0;
  let navigationIdentity = 0;
  let navigationOrigin: 'initial' | 'application' | 'history' = 'initial';
  let navigationDestination: string | null = null;
  const listeners = new Set<() => void>();
  let unpublished = false;
  const notify = () => {
    unpublished = false;
    listeners.forEach((listener) => listener());
  };
  return {
    snapshot: () => ({ serial, generation }),
    navigationIdentity: () => navigationIdentity,
    navigationOrigin: () => navigationOrigin,
    navigationDestination: () => navigationDestination,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigation(destination: string | null) {
      navigationOrigin = 'application';
      serial++;
      navigationIdentity++;
      navigationDestination = destination;
      notify();
    },
    retire(publish = true) {
      generation++;
      if (publish) notify();
      else unpublished = true;
    },
    publish() {
      if (unpublished) notify();
    },
    history(destination: string | null) {
      navigationOrigin = 'history';
      navigationIdentity++;
      generation++;
      navigationDestination = destination;
      notify();
    },
  };
}
