/** Provider-local navigation identity. No private content, DOM or credentials. */
export function createRouteCommandState() {
  let serial = 0;
  let generation = 0;
  let navigationIdentity = 0;
  let navigationDestination: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    snapshot: () => ({ serial, generation }),
    navigationIdentity: () => navigationIdentity,
    navigationDestination: () => navigationDestination,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigation(destination: string | null) {
      serial++;
      navigationIdentity++;
      navigationDestination = destination;
      notify();
    },
    retire() {
      generation++;
      notify();
    },
    history(destination: string | null) {
      navigationIdentity++;
      generation++;
      navigationDestination = destination;
      notify();
    },
  };
}
