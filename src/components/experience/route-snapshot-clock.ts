import { cancelRouteSnapshots } from './route-motion-state';

type Registration = {
  animations: Animation[];
  valid: () => boolean;
  unsupported?: () => void;
  retired: boolean;
};
const pending = new WeakMap<object, Registration[]>();
const finalized = new WeakSet<object>();
const activeTransition = () =>
  (document as Document & { activeViewTransition?: object })
    .activeViewTransition;
function documentTime() {
  const time = document.timeline?.currentTime;
  if (typeof time !== 'number' || !Number.isFinite(time))
    throw new Error('Unsupported snapshot document clock');
  return time;
}

/** React registers all ready callbacks synchronously. Align their exact effects
 * once, after registration and before paint/completion-collector microtasks.
 * Only the native transition identity and short-lived effect owners are kept.
 */
export function registerRouteSnapshotClock(
  animations: Animation[],
  valid: () => boolean,
  unsupported?: () => void,
) {
  const transition = activeTransition();
  if (!transition) throw new Error('Unsupported active snapshot identity');
  if (finalized.has(transition))
    throw new Error('Late snapshot clock registration');
  let registrations = pending.get(transition);
  if (!registrations) {
    registrations = [];
    pending.set(transition, registrations);
    const scheduled = registrations;
    queueMicrotask(() => {
      pending.delete(transition);
      finalized.add(transition);
      const owners = scheduled.filter((owner) => !owner.retired);
      if (!owners.length) return;
      const effects = new Set(owners.flatMap((owner) => owner.animations));
      const current = activeTransition() === transition;
      try {
        if (
          !current ||
          owners.some((owner) => !owner.valid()) ||
          activeTransition() !== transition
        )
          throw new Error('Expired snapshot clock ownership');
        const time = documentTime();
        effects.forEach((animation) => {
          // Never revive an effect canceled by an earlier callback/cleanup.
          if (animation.playState !== 'idle') animation.startTime = time;
        });
      } catch {
        effects.forEach((animation) => animation.cancel());
        if (activeTransition() === transition) {
          owners.forEach((owner) => owner.unsupported?.());
          if (activeTransition() === transition) cancelRouteSnapshots();
        }
      }
    });
  }
  const owner: Registration = {
    animations,
    valid,
    unsupported,
    retired: false,
  };
  registrations.push(owner);
  return () => {
    owner.retired = true;
  };
}
