type Preference = { enabled: boolean; persistence: boolean };
const serverPreference: Preference = { enabled: true, persistence: true };
/** Each provider owns one actor/backend-scoped store; only the boolean is durable. */
export function createShortcutPreference(storageKey: string) {
  let value = serverPreference;
  const listeners = new Set<() => void>();
  function notify(next: Preference) {
    if (
      next.enabled === value.enabled &&
      next.persistence === value.persistence
    )
      return;
    value = next;
    for (const listener of listeners) listener();
  }
  function refresh() {
    try {
      const raw = localStorage.getItem(storageKey);
      notify({ enabled: raw !== 'false', persistence: true });
    } catch {
      notify({ ...value, persistence: false });
    }
  }
  return {
    snapshot: () => value,
    serverSnapshot: () => serverPreference,
    subscribe(listener: () => void) {
      listeners.add(listener);
      function storage(event: StorageEvent) {
        if (event.key === storageKey || event.key === null) refresh();
      }
      window.addEventListener('storage', storage);
      refresh();
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', storage);
      };
    },
    setEnabled(enabled: boolean) {
      let persistence = true;
      try {
        localStorage.setItem(storageKey, String(enabled));
      } catch {
        persistence = false;
      }
      notify({ enabled, persistence });
    },
  };
}
