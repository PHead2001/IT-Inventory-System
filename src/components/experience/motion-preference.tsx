'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { MotionConfig } from 'motion/react';

const storageKey = 'it-inventory-reduce-motion';
const changeEvent = 'it-inventory-motion-change';
let volatilePreference: boolean | null = null;

function subscribe(listener: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== storageKey && event.key !== null) return;
    volatilePreference = null;
    listener();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, listener);
  };
}

function snapshot() {
  if (volatilePreference !== null) return volatilePreference;
  try {
    return window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function subscribeSystem(listener: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

function systemSnapshot() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useEffectiveReducedMotion() {
  const local = useSyncExternalStore(subscribe, snapshot, () => true);
  const system = useSyncExternalStore(
    subscribeSystem,
    systemSnapshot,
    () => true,
  );
  return local || system;
}

export function MotionPreference({ children }: { children: React.ReactNode }) {
  const reduced = useEffectiveReducedMotion();

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  );
}

export function MotionToggle() {
  const localReduced = useSyncExternalStore(subscribe, snapshot, () => false);

  function toggle() {
    const next = !localReduced;
    volatilePreference = next;
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      // Storage can be unavailable under browser policy; keep this tab usable.
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="experience-motion-toggle"
      aria-pressed={localReduced}
      aria-label="Reduce motion"
    >
      {localReduced ? 'Motion reduced' : 'Reduce motion'}
    </button>
  );
}
