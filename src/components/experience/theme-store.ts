'use client';
import { cancelThemeSnapshot } from './native-transition-owner';
import { revealTheme } from './theme-transition';
export type ThemePreference = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';
export type ThemeSnapshot = {
  preference: ThemePreference;
  theme: Theme;
  scope: string;
};
export type ThemeBootstrap = {
  parse: (raw: string | null) => ThemePreference;
  key: (scope: string) => string;
  read: (scope: string) => ThemePreference;
  resolve: (preference: ThemePreference) => Theme;
  apply: (preference: ThemePreference) => Theme;
};
declare global {
  interface Window {
    inventoryTheme?: ThemeBootstrap;
  }
}
const serverPreference = (scope: string): ThemeSnapshot => ({
  scope,
  preference: 'dark',
  theme: 'dark',
});
/** One external store per root provider. Volatile choices remain usable without storage. */
export function createThemeStore(initialScope: string) {
  let scope = initialScope;
  const serverSnapshot = serverPreference(initialScope);
  let snapshot = serverPreference(scope);
  let generation = 0;
  let scopeRevision = 0;
  let intended: ThemePreference = 'dark';
  let dispose: (() => void) | null = null;
  let owner = Symbol();
  let phase: 'created' | 'mounted' | 'disposed' = 'created';
  const prepareMount = () => {
    if (phase === 'disposed') {
      owner = Symbol();
      phase = 'created';
    }
  };
  const listeners = new Set<() => void>();
  const publish = (preference: ThemePreference, notify = true) => {
    intended = preference;
    const theme = window.inventoryTheme?.apply(preference) ?? 'dark';
    snapshot = { scope, preference, theme };
    if (notify) listeners.forEach((listener) => listener());
  };
  const refresh = (notify = true) =>
    publish(window.inventoryTheme?.read(scope) ?? 'dark', notify);
  const choose = (
    preference: ThemePreference,
    control?: HTMLElement,
    automatic = false,
  ) => {
    if (!window.inventoryTheme) return;
    const version = ++generation;
    intended = preference;
    const destination = window.inventoryTheme.resolve(preference);
    const apply = () => {
      if (generation === version) publish(preference);
    };
    if (!automatic) {
      try {
        localStorage.setItem(
          window.inventoryTheme.key(scope),
          JSON.stringify({ version: 1, preference }),
        );
      } catch {
        /* This tab retains the choice; no anonymous/other-user fallback. */
      }
    }
    revealTheme({
      apply,
      changed: destination !== snapshot.theme,
      control,
      automatic,
    });
  };
  const setScope = (next: string, force = false, notify = true) => {
    if (!force && scope === next) return;
    generation += 1;
    // Commands belong to this exact scope lifetime, not merely its actor key.
    // Retire before cancellation can invoke retained callbacks, including A→B→A
    // and forced resets that intentionally keep the same storage partition.
    scopeRevision += 1;
    cancelThemeSnapshot();
    scope = next;
    document.documentElement.dataset.themeScope = scope;
    refresh(notify);
  };
  return {
    snapshot: () => snapshot,
    serverSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get choose() {
      const token = owner;
      const revision = scopeRevision;
      return (...args: Parameters<typeof choose>) => {
        if (
          phase === 'mounted' &&
          owner === token &&
          scopeRevision === revision
        )
          choose(...args);
      };
    },
    get scope() {
      const token = owner;
      const revision = scopeRevision;
      return (next: string) => {
        if (
          phase !== 'disposed' &&
          owner === token &&
          scopeRevision === revision
        )
          setScope(next);
      };
    },
    get resetScope() {
      const token = owner;
      const revision = scopeRevision;
      return (next: string, notify = true) => {
        if (
          phase !== 'disposed' &&
          owner === token &&
          scopeRevision === revision
        )
          setScope(next, true, notify);
      };
    },
    prepareMount,
    mount: () => {
      dispose?.();
      prepareMount();
      const token = owner;
      phase = 'mounted';
      refresh();
      const media =
        typeof matchMedia === 'function'
          ? matchMedia('(prefers-color-scheme: light)')
          : null;
      const systemChanged = () => {
        if (phase !== 'mounted' || owner !== token) return;
        if (intended === 'system') choose('system', undefined, true);
      };
      const storageChanged = (event: StorageEvent) => {
        if (phase !== 'mounted' || owner !== token) return;
        if (event.storageArea && event.storageArea !== localStorage) return;
        if (event.key !== window.inventoryTheme?.key(scope)) return;
        generation += 1;
        cancelThemeSnapshot();
        publish(window.inventoryTheme?.parse(event.newValue) ?? 'dark');
      };
      window.addEventListener('storage', storageChanged);
      media?.addEventListener('change', systemChanged);
      const cleanup = () => {
        if (phase !== 'mounted' || owner !== token) return;
        phase = 'disposed';
        listeners.clear();
        generation += 1;
        cancelThemeSnapshot();
        window.removeEventListener('storage', storageChanged);
        media?.removeEventListener('change', systemChanged);
        if (dispose === cleanup) dispose = null;
      };
      dispose = cleanup;
      return cleanup;
    },
  };
}
