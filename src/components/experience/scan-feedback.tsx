'use client';
import {
  useCallback,
  useMemo,
  useState,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useStrictPresentation } from './strict-presentation';
import { useEffectiveReducedMotion } from './motion-preference';
import { observeRouteSnapshotWithdrawal } from './route-motion-state';

const key = 'it-inventory-scan-feedback-v1';
const eventName = 'it-inventory-scan-feedback-change';
type Preference = { sound: boolean; haptics: boolean };
export type ScanCue = 'decode' | 'assignment' | 'no-match' | 'blocked';
let volatile: Preference | null = null;
let context: AudioContext | null = null;
let activated = false;
let gesture = false;
let activation = 0;
let vibrating = false;
let activationOwner: object | null = null;
let activationCurrent = () => false;
let activationReduced = false;
const voices = new Set<OscillatorNode>();
function read(): Preference {
  if (volatile) return volatile;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return { sound: value?.sound === true, haptics: value?.haptics !== false };
  } catch {
    return { sound: false, haptics: true };
  }
}
function subscribe(listener: () => void) {
  const changed = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    volatile = null;
    stopScanFeedback();
    listener();
  };
  window.addEventListener('storage', changed);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener(eventName, listener);
  };
}
function snapshot() {
  const value = read();
  return `${value.sound}:${value.haptics}`;
}
/** Read the canonical root and OS at the call site, before React effects catch up. */
export function scanReducedMotionNow(knownReduced = false) {
  return (
    knownReduced ||
    document.documentElement.dataset.motion === 'reduced' ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}
/** Called only by the admitted owner's synchronous trusted scanner gesture. */
function primeScanFeedback(
  trusted: boolean,
  owner: object,
  current: () => boolean,
  reduced: boolean,
) {
  if (!trusted || document.hidden || !current()) {
    stopScanFeedback(owner);
    return;
  }
  stopScanFeedback();
  activationOwner = owner;
  activationCurrent = current;
  activationReduced = scanReducedMotionNow(reduced);
  gesture = true;
  if (!read().sound) return;
  try {
    context ??= new AudioContext();
    activated = true;
    const token = ++activation;
    const activeContext = context;
    void context
      .resume()
      .then(() => {
        if (
          token !== activation &&
          (!activationOwner || !activationCurrent() || document.hidden)
        )
          void activeContext.suspend().catch(() => {});
      })
      .catch(() => {
        if (token === activation) activated = false;
      });
  } catch {
    activated = false;
  }
}
export function stopScanFeedback(owner?: object) {
  if (owner && activationOwner !== owner) return;
  activationOwner = null;
  activationCurrent = () => false;
  activation++;
  activated = false;
  gesture = false;
  for (const voice of voices) {
    try {
      voice.stop();
    } catch {
      /* Optional browser feedback. */
    }
  }
  voices.clear();
  if (context) void context.suspend().catch(() => {});
  if (vibrating) {
    try {
      navigator.vibrate?.(0);
    } catch {
      /* Optional browser feedback. */
    }
    vibrating = false;
  }
}
function emit(kind: ScanCue, reduced: boolean, owner: object) {
  if (activationOwner !== owner || !activationCurrent() || document.hidden)
    return;
  if (!activationReduced && reduced) {
    stopScanFeedback(owner);
    return;
  }
  const preference = read();
  if (preference.haptics && gesture && !reduced) {
    try {
      navigator.vibrate?.(
        kind === 'decode'
          ? 20
          : kind === 'assignment'
            ? [20, 35, 20]
            : kind === 'no-match'
              ? [60, 50, 60]
              : [100, 50, 100],
      );
      vibrating = typeof navigator.vibrate === 'function';
    } catch {
      /* Optional browser feedback. */
    }
  }
  // A suspended context drops this cue. Nothing queues for a later activation.
  if (
    !preference.sound ||
    !activated ||
    !context ||
    context.state !== 'running'
  )
    return;
  try {
    if (voices.size >= 2) {
      const oldest = voices.values().next().value;
      try {
        oldest?.stop();
      } catch {
        /* Optional. */
      }
      if (oldest) voices.delete(oldest);
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const duration =
      kind === 'decode'
        ? 0.06
        : kind === 'assignment'
          ? 0.12
          : kind === 'no-match'
            ? 0.18
            : 0.24;
    oscillator.frequency.value =
      kind === 'decode'
        ? 660
        : kind === 'assignment'
          ? 990
          : kind === 'no-match'
            ? 220
            : 150;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 0.008);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    voices.add(oscillator);
    oscillator.onended = () => {
      voices.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch {
    /* Unsupported audio never interrupts inspection. */
  }
}
/** Strict managed privacy is required even when optional feedback APIs exist.
 * The return value admits decorative lock feedback too; it is not API success. */
export function useScanFeedback(
  host: RefObject<Element | null>,
  identity: string,
) {
  const seen = useRef(new Set<string>());
  const [owner] = useState(() => ({}));
  const reduced = useEffectiveReducedMotion();
  const motion = useRef(reduced);
  const preference = useSyncExternalStore(
    subscribe,
    snapshot,
    () => 'false:true',
  );
  const stop = useCallback(() => stopScanFeedback(owner), [owner]);
  const current = useStrictPresentation(host, identity, stop);
  const reconcile = useCallback(() => {
    if (
      activationOwner === owner &&
      (!current() ||
        (!activationReduced && scanReducedMotionNow(motion.current)))
    )
      stop();
  }, [owner, current, stop]);
  useInsertionEffect(() => {
    motion.current = reduced;
    reconcile();
  }, [reduced, reconcile]);
  useLayoutEffect(() => {
    stop();
  }, [preference, stop]);
  useLayoutEffect(() => {
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const observer = new MutationObserver(reconcile);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    const snapshots = observeRouteSnapshotWithdrawal(stop);
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', reconcile);
    media?.addEventListener('change', reconcile);
    return () => {
      observer.disconnect();
      snapshots();
      stop();
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', reconcile);
      media?.removeEventListener('change', reconcile);
    };
  }, [stop, reconcile]);
  const cue = useCallback(
    (kind: ScanCue, id: string) => {
      if (seen.current.has(id)) return false;
      // Consume suppressed cues too: readmission never becomes a new event.
      if (seen.current.size >= 256)
        seen.current.delete(seen.current.values().next().value!);
      seen.current.add(id);
      if (!current()) return false;
      emit(kind, scanReducedMotionNow(motion.current), owner);
      return true;
    },
    [current, owner],
  );
  const prime = useCallback(
    (trusted: boolean) =>
      primeScanFeedback(trusted, owner, current, motion.current),
    [current, owner],
  );
  // Object.assign decorates these event callbacks; it never invokes them or reads
  // their captured refs. Keep the exception on this callback-decoration line.
  // eslint-disable-next-line react-hooks/refs
  return useMemo(() => Object.assign(cue, { prime, stop }), [cue, prime, stop]);
}

export function ScanFeedbackToggle() {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'false:true');
  const [sound, haptics] = value.split(':').map((part) => part === 'true');
  return (
    <div className="space-y-2">
      {(['sound', 'haptics'] as const).map((name) => (
        <label key={name} className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={name === 'sound' ? sound : haptics}
            onChange={(event) => {
              volatile = { ...read(), [name]: event.target.checked };
              try {
                localStorage.setItem(key, JSON.stringify(volatile));
              } catch {
                /* Keep this tab usable. */
              }
              stopScanFeedback();
              // Enabling a preference is silent. A subsequent scanner gesture primes audio.
              window.dispatchEvent(new Event(eventName));
            }}
          />
          {name === 'sound'
            ? 'Scan sounds'
            : 'Scan vibrations (supported devices)'}
        </label>
      ))}
      <p className="experience-muted text-sm">
        Optional feedback for this browser. Sounds start after a scanner action.
        Reduced motion disables vibrations. Scan status always appears on
        screen.
      </p>
    </div>
  );
}
