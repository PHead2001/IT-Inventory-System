/** Provider-local navigation identity. No private content, DOM or credentials. */
export function createRouteCommandState() {
  let serial = 0;
  let generation = 0;
  let navigationIdentity = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    snapshot: () => ({ serial, generation }),
    navigationIdentity: () => navigationIdentity,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigation() {
      serial++;
      navigationIdentity++;
      notify();
    },
    retire() {
      generation++;
      notify();
    },
    history() {
      navigationIdentity++;
      generation++;
      notify();
    },
  };
}
