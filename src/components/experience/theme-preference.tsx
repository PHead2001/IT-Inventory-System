'use client';
import {
  usePrivacyReadiness,
  usePrivacyRevocationRevision,
} from '@/components/auth/privacy-readiness';
import { revokePrivatePresentation } from '@/features/scan/assign-batch';
import { freshPresentationGrant } from './presentation-privacy';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useInsertionEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createThemeStore, type ThemePreference } from './theme-store';
const Context = createContext<ReturnType<typeof createThemeStore> | null>(null);
export function ThemePreferenceProvider({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [store] = useState(() => createThemeStore(scope));
  const previous = useRef(scope);
  // Re-arm only this committed mount's lifecycle before member child layout.
  // No preference, DOM write, notification or presentation grant is made here.
  useInsertionEffect(() => store.prepareMount(), [store]);
  // A child member boundary can establish a newer verified scope on the first
  // commit. Mounting the provider must not overwrite it with an older header.
  useLayoutEffect(() => store.mount(), [store]);
  useLayoutEffect(() => {
    if (previous.current !== scope) {
      previous.current = scope;
      // A changing header/root prop is not a fresh member grant. Reset the
      // destination backend only after synchronously withdrawing private owners.
      // Their store generation is retired before cancellation can run callbacks.
      revokePrivatePresentation();
      store.resetScope(scope.replace(/:[^:]+$/, ':anonymous'));
    }
  }, [store, scope]);
  return <Context value={store}>{children}</Context>;
}
export function VerifiedThemeScope({ scope }: { scope: string }) {
  const store = useContext(Context);
  const privacy = usePrivacyReadiness();
  const revision = usePrivacyRevocationRevision();
  useLayoutEffect(() => {
    if (privacy.generation !== 'unmanaged' && freshPresentationGrant(privacy))
      store?.scope(scope);
  }, [store, scope, privacy, revision]);
  return null;
}
export function useThemeScopeReset() {
  const store = useContext(Context);
  return useCallback(
    (notify = true) => {
      const current = store?.snapshot().scope;
      if (current)
        store?.resetScope(current.replace(/:[^:]+$/, ':anonymous'), notify);
    },
    [store],
  );
}
const fallback = {
  scope: 'anonymous',
  theme: 'dark',
  preference: 'dark',
} as const;
const fallbackSnapshot = () => fallback;
const fallbackSubscribe = () => () => {};
export function useThemePreference() {
  const store = useContext(Context);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? fallbackSubscribe,
    store?.snapshot ?? fallbackSnapshot,
    store?.serverSnapshot ?? fallbackSnapshot,
  );
  return { ...snapshot, choose: store?.choose ?? (() => {}) };
}
export function ThemeControl() {
  const { preference, choose } = useThemePreference();
  return (
    <fieldset className="experience-theme-control">
      <legend>Theme in this browser</legend>
      <div className="experience-theme-options">
        {(['dark', 'light', 'system'] as ThemePreference[]).map((option) => (
          <label key={option} data-selected={preference === option}>
            <input
              type="radio"
              name="theme-preference"
              value={option}
              checked={preference === option}
              onChange={(event) =>
                choose(
                  option,
                  event.currentTarget.closest('label') ?? event.currentTarget,
                )
              }
            />
            <span>{option[0].toUpperCase() + option.slice(1)}</span>
          </label>
        ))}
      </div>
      <p className="experience-muted text-sm">
        Dark is the default. System follows your device&apos;s appearance.
      </p>
    </fieldset>
  );
}
export function QuickThemeToggle() {
  const { theme, choose } = useThemePreference();
  return (
    <button
      type="button"
      className="experience-theme-quick"
      aria-label={
        theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'
      }
      onClick={(event) =>
        choose(theme === 'dark' ? 'light' : 'dark', event.currentTarget)
      }
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      <span className="sr-only">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
