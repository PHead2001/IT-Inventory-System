'use client';

import { animate } from 'motion';
import {
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from './presentation-privacy';
import { useStrictPresentation } from './strict-presentation';
import { useRouteMotion } from './route-motion';
import { observeRouteSnapshotWithdrawal } from './route-motion-state';
import { renderedPresentation } from './rendered-motion';

export const springPresentation = {
  duration: 0.22,
  bounce: 0.08,
  deadline: 250,
};
function createPresence(initial: boolean) {
  let present = initial;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => present,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: () => listeners.forEach((listener) => listener()),
    set(next: boolean, notify = true) {
      if (present === next) return;
      present = next;
      if (notify) listeners.forEach((listener) => listener());
    },
  };
}
type Props = HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  instanceKey: string;
  kind: 'popover' | 'panel' | 'disclosure' | 'toast';
  /** Consumer must synchronously retire interaction before requesting exit. */
  retainExit?: boolean;
  keepMounted?: boolean;
  animateEnter?: boolean;
  onExitComplete?: () => void;
  onPresentationChange?: () => void;
  surfaceRef?: RefObject<HTMLDivElement | null>;
  stopPresentationRef?: RefObject<(() => void) | null>;
  children: ReactNode;
};
function createBinding(key: string) {
  let retired = false;
  return {
    key,
    current: () => !retired,
    retire: () => {
      retired = true;
    },
  };
}
function fullMotion() {
  return (
    document.visibilityState !== 'hidden' &&
    document.documentElement.dataset.motion === 'full' &&
    typeof matchMedia === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
/** No preference-reading hook exists until the current managed grant is fresh. */
function SpringMotion({
  host,
  surface,
  props,
  presence,
  withdraw,
  stopRef,
  insertionRef,
}: {
  host: RefObject<HTMLDivElement | null>;
  surface: RefObject<HTMLDivElement | null>;
  props: Props;
  presence: ReturnType<typeof createPresence>;
  withdraw: () => void;
  stopRef: RefObject<(() => void) | undefined>;
  insertionRef: RefObject<boolean>;
}) {
  const {
    open,
    instanceKey,
    kind,
    retainExit = false,
    animateEnter = true,
  } = props;
  const callbacks = useRef(props);
  useInsertionEffect(() => {
    callbacks.current = props;
  });
  useInsertionEffect(() => {
    insertionRef.current = true;
  });
  const privacy = usePrivacyReadiness();
  const strict = useStrictPresentation(
    host,
    JSON.stringify([privacy.generation, props.instanceKey]),
    withdraw,
  );
  const route = useRouteMotion();
  const latestRoute = useRef(route.validNow);
  const previous = useRef({ open: false, key: props.instanceKey });
  useInsertionEffect(() => {
    latestRoute.current = route.validNow;
  });
  useLayoutEffect(() => observeRouteSnapshotWithdrawal(withdraw), [withdraw]);
  useLayoutEffect(() => {
    const reconcile = () => {
      if (!strict() || !latestRoute.current() || !fullMotion()) withdraw();
    };
    const observer = new MutationObserver(reconcile);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    const media =
      typeof matchMedia === 'function'
        ? matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    media?.addEventListener('change', reconcile);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', reconcile);
    };
  }, [strict, withdraw]);
  useLayoutEffect(() => {
    const changed =
      previous.current.open !== open || previous.current.key !== instanceKey;
    previous.current = { open, key: instanceKey };
    const element = surface.current;
    stopRef.current?.();
    stopRef.current = undefined;
    const current = () => strict() && latestRoute.current() && fullMotion();
    if (
      !element ||
      !current() ||
      !renderedPresentation(element) ||
      (!open && !retainExit)
    ) {
      if (!open) withdraw();
      return;
    }
    if (open) presence.set(true);
    if (
      !changed ||
      (open && !animateEnter) ||
      typeof element.animate !== 'function'
    ) {
      if (!open) withdraw();
      return;
    }
    const original = {
      opacity: element.style.opacity,
      transform: element.style.transform,
      height: element.style.height,
      overflow: element.style.overflow,
    };
    const collapsed =
      kind === 'disclosure'
        ? { opacity: 0, height: 0 }
        : {
            opacity: 0,
            transform: `translateY(${kind === 'toast' ? 12 : 6}px) scale(0.98)`,
          };
    const expanded =
      kind === 'disclosure'
        ? { opacity: 1, height: element.scrollHeight }
        : { opacity: 1, transform: 'translateY(0px) scale(1)' };
    if (kind === 'disclosure') element.style.setProperty('overflow', 'hidden');
    if (open) {
      element.style.setProperty('opacity', '0');
      if (kind === 'disclosure') element.style.setProperty('height', '0px');
      else element.style.setProperty('transform', collapsed.transform!);
    }
    let live = true;
    let frame = 0;
    const control = animate(element, open ? expanded : collapsed, {
      type: 'spring',
      duration: springPresentation.duration,
      bounce: springPresentation.bounce,
      onUpdate: () => {
        if (!live) return;
        if (!current()) {
          withdraw();
          return;
        }
        callbacks.current.onPresentationChange?.();
      },
    });
    const stop = () => {
      if (!live) return;
      live = false;
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      control.cancel();
      Object.assign(element.style, original);
      callbacks.current.onPresentationChange?.();
    };
    const settle = () => {
      if (!live) return;
      stop();
      if (!open) {
        presence.set(false);
        callbacks.current.onExitComplete?.();
      }
      if (stopRef.current === stop) stopRef.current = undefined;
    };
    const timeout = setTimeout(settle, springPresentation.deadline);
    const check = () => {
      if (!live) return;
      if (!current() || !renderedPresentation(element)) {
        withdraw();
        return;
      }
      callbacks.current.onPresentationChange?.();
      frame = requestAnimationFrame(check);
    };
    stopRef.current = stop;
    frame = requestAnimationFrame(check);
    return stop;
  }, [
    open,
    instanceKey,
    kind,
    retainExit,
    animateEnter,
    presence,
    strict,
    surface,
    stopRef,
    withdraw,
  ]);
  return null;
}

/** Only the original subtree can exit; never cache or clone private React nodes. */
export function SpringPresence(props: Props) {
  const {
    open,
    instanceKey,
    kind,
    retainExit,
    keepMounted = false,
    animateEnter,
    onExitComplete,
    onPresentationChange,
    surfaceRef,
    stopPresentationRef,
    children,
    ...attributes
  } = props;
  const privacy = usePrivacyReadiness();
  const [binding] = useState(() => createBinding(privacy.generation));
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  const insertion = useRef(false);
  const bookkeeping = useRef(false);
  const latest = useRef({ open, onExitComplete, onPresentationChange });
  const [presence] = useState(() => createPresence(open));
  const present = useSyncExternalStore(
    presence.subscribe,
    presence.snapshot,
    presence.snapshot,
  );
  const withdraw = useCallback(() => {
    stop.current?.();
    stop.current = undefined;
    if (!latest.current.open) {
      if (surface.current) {
        surface.current.hidden = true;
        surface.current.inert = true;
      }
      presence.set(false, !insertion.current);
      if (insertion.current) bookkeeping.current = true;
      else latest.current.onExitComplete?.();
    }
    latest.current.onPresentationChange?.();
  }, [presence]);
  const fresh =
    privacy.generation !== 'unmanaged' && freshPresentationGrant(privacy);
  useInsertionEffect(() => {
    insertion.current = true;
    latest.current = { open, onExitComplete, onPresentationChange };
    if (binding.key !== privacy.generation) binding.retire();
    if (!fresh || !binding.current()) withdraw();
  });
  useLayoutEffect(() => {
    insertion.current = false;
    if (bookkeeping.current) {
      bookkeeping.current = false;
      presence.publish();
      if (!latest.current.open) latest.current.onExitComplete?.();
    }
  });
  useLayoutEffect(() => {
    if (open) {
      presence.set(true);
      if (surface.current) surface.current.hidden = attributes.hidden === true;
    } else if (!fresh || !binding.current()) withdraw();
    if (stopPresentationRef) stopPresentationRef.current = withdraw;
    return () => {
      if (stopPresentationRef) stopPresentationRef.current = null;
    };
  }, [
    open,
    fresh,
    presence,
    withdraw,
    stopPresentationRef,
    attributes.hidden,
    binding,
  ]);
  useLayoutEffect(
    () => () => {
      stop.current?.();
    },
    [],
  );
  const bindSurface = useCallback(
    (node: HTMLDivElement | null) => {
      surface.current = node;
      if (surfaceRef) surfaceRef.current = node;
    },
    [surfaceRef],
  );
  return (
    <div ref={host} className="contents">
      {(open || present || keepMounted) && (
        <div
          {...attributes}
          ref={bindSurface}
          data-spring-presence={kind}
          data-spring-state={open ? 'open' : 'exiting'}
          hidden={attributes.hidden || (!open && !present)}
          inert={!open || attributes.inert}
          aria-hidden={!open || attributes['aria-hidden']}
          onClickCapture={(event) => {
            if (!open) {
              event.preventDefault();
              event.stopPropagation();
            } else attributes.onClickCapture?.(event);
          }}
          onSubmitCapture={(event) => {
            if (!open) {
              event.preventDefault();
              event.stopPropagation();
            } else attributes.onSubmitCapture?.(event);
          }}
          onKeyDownCapture={(event) => {
            if (!open) {
              event.preventDefault();
              event.stopPropagation();
            } else attributes.onKeyDownCapture?.(event);
          }}
        >
          {children}
        </div>
      )}
      {fresh && !!binding.current() && (
        <SpringMotion
          host={host}
          surface={surface}
          props={{ ...props, instanceKey, retainExit, animateEnter }}
          presence={presence}
          withdraw={withdraw}
          stopRef={stop}
          insertionRef={insertion}
        />
      )}
    </div>
  );
}
