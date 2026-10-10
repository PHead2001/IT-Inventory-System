'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { MotionConfig } from 'motion/react';
import { cancelRouteSnapshots } from './route-motion-state';

const storageKey = 'it-inventory-reduce-motion';
const changeEvent = 'it-inventory-motion-change';
let volatilePreference: boolean | null = null;

function subscribe(listener: () => void) {
  function changed() {
    // Suppress already-running native snapshots before React's next render.
    if (snapshot() || systemSnapshot()) {
      document.documentElement.dataset.motion = 'reduced';
      cancelRouteSnapshots();
    }
    listener();
  }
  function onStorage(event: StorageEvent) {
    if (event.key !== storageKey && event.key !== null) return;
    volatilePreference = null;
    changed();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, changed);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, changed);
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
  const changed = () => {
    if (media.matches) {
      document.documentElement.dataset.motion = 'reduced';
      cancelRouteSnapshots();
    }
    listener();
  };
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}

function systemSnapshot() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useEffectiveReducedMotion() {
  const { local, system } = useMotionState();
  return local || system;
}

export function useMotionState() {
  const local = useSyncExternalStore(subscribe, snapshot, () => true);
  const system = useSyncExternalStore(
    subscribeSystem,
    systemSnapshot,
    () => true,
  );
  return { local, system, reduced: local || system };
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
  const { local, system } = useMotionState();

  function toggle() {
    const next = !local;
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
      aria-pressed={local}
      aria-label={local ? 'Use system motion setting' : 'Reduce motion locally'}
    >
      <span>
        {local
          ? 'Reduced locally'
          : system
            ? 'Reduced by system'
            : 'Full motion'}
      </span>
      <small>
        {local
          ? 'Use system setting'
          : system
            ? 'System setting active · reduce locally'
            : 'Reduce motion'}
      </small>
    </button>
  );
}
