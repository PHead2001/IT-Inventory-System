'use client';

import { useEffect, useId, useSyncExternalStore } from 'react';
import { MotionConfig } from 'motion/react';

const storageKey = 'it-inventory-reduce-motion';
const changeEvent = 'it-inventory-motion-change';
let volatilePreference: boolean | null = null;

function subscribeReadiness() {
  return () => {};
}

function browserReady() {
  return true;
}

function serverReady() {
  return false;
}

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
  const descriptionId = useId();
  const { local, system } = useMotionState();
  const ready = useSyncExternalStore(
    subscribeReadiness,
    browserReady,
    serverReady,
  );

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
    <div className="space-y-2">
      <button
        type="button"
        role={ready ? 'switch' : undefined}
        onClick={toggle}
        disabled={!ready}
        className="experience-motion-toggle"
        aria-checked={ready ? local : undefined}
        aria-label="Reduce motion in this browser"
        aria-describedby={descriptionId}
      >
        <span>Reduce motion in this browser</span>
        <span aria-hidden="true" className="experience-motion-state">
          <span className="experience-motion-track">
            <span />
          </span>
          {!ready ? 'Loading' : local ? 'On' : 'Off'}
        </span>
      </button>
      <p id={descriptionId} className="experience-muted text-sm">
        {!ready
          ? "Loading this browser's motion preference."
          : local
            ? system
              ? 'Reduced motion is active. Your system also requires reduced motion.'
              : 'Reduced motion is active in this browser.'
            : system
              ? 'Reduced motion is required by your system, even when this switch is off.'
              : 'Full motion is active.'}
      </p>
    </div>
  );
}
