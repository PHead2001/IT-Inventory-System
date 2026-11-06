'use client';
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  type ReactElement,
  type SyntheticEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { SpringPresence } from '@/components/experience/spring-presence';
import {
  useStrictPresentation,
  strictPresentationCurrent,
} from '@/components/experience/strict-presentation';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { renderedPresentation } from '@/components/experience/rendered-motion';
import {
  createRoomObstructionOwner,
  type RoomObstructionRegistration,
} from '@/components/experience/room-obstructions';
import { usePathname } from 'next/navigation';
import Link from '@/components/experience/route-link';
import { ShowInRoom } from '@/features/room/show-in-room';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { recordStatusLabel } from '@/lib/record-status';
import { focusAfterPeek } from './focus-order';
import { PeekAccessLost } from './cache';
import {
  peekHref,
  peekKey,
  type PeekPayload,
  type PeekTarget,
} from './contracts';
import { usePeekScope } from './peek-provider';
import styles from './peek.module.css';

type PeekTriggerProps = Pick<
  ComponentProps<typeof Link>,
  | 'aria-haspopup'
  | 'aria-expanded'
  | 'aria-controls'
  | 'onPointerDown'
  | 'onPointerEnter'
  | 'onPointerLeave'
  | 'onFocus'
  | 'onBlur'
  | 'onKeyDown'
  | 'onClick'
>;
type PeekChildren = ReactNode | ((trigger: PeekTriggerProps) => ReactNode);
function compose<T extends SyntheticEvent>(
  existing: ((event: T) => void) | undefined,
  peek: ((event: T) => void) | undefined,
) {
  return (event: T) => {
    existing?.(event);
    if (!event.defaultPrevented) peek?.(event);
  };
}

function createPeekObstructionConnection(
  element: RefObject<HTMLDivElement | null>,
  current: () => boolean,
  subscribeClose: NonNullable<
    ReturnType<typeof usePeekScope>
  >['subscribeClose'],
  open: boolean,
) {
  let registration: RoomObstructionRegistration | null = null;
  return {
    snapshot: () => registration,
    subscribe(changed: () => void) {
      const node = element.current;
      if (!open || !node || !current() || !renderedPresentation(node))
        return () => {};
      const owner = createRoomObstructionOwner(node.ownerDocument);
      const owned = owner.register(node);
      registration = owned;
      changed();
      const retire = () => {
        owner.retire();
        if (registration === owned) {
          registration = null;
          changed();
        }
      };
      const unsubscribe = subscribeClose(retire);
      return () => {
        unsubscribe();
        retire();
      };
    },
  };
}
function usePeekObstruction(
  element: RefObject<HTMLDivElement | null>,
  current: () => boolean,
  subscribeClose: NonNullable<
    ReturnType<typeof usePeekScope>
  >['subscribeClose'],
  open: boolean,
) {
  const connection = useMemo(
    () =>
      createPeekObstructionConnection(element, current, subscribeClose, open),
    [element, current, subscribeClose, open],
  );
  return useSyncExternalStore(
    connection.subscribe,
    connection.snapshot,
    () => null,
  )?.change;
}

function RecognitionPhoto({
  photo,
  scope,
}: {
  photo: NonNullable<PeekPayload['photo']>;
  scope: NonNullable<ReturnType<typeof usePeekScope>>;
}) {
  const [client] = useState(createSupabaseBrowserClient);
  const { current: scopeCurrent, subscribeClose, cache, deadline } = scope;
  const [image, setImage] = useState<{ path: string; url: string } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    const retire = () => {
      alive = false;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      setImage(null);
    };
    const unsubscribe = subscribeClose(retire);
    // Cancellation is best effort. The physical slot survives an uncooperative
    // Storage request until its promise and blob consumption actually settle.
    void cache.network
      .run(
        async (signal) => {
          if (!alive || !scopeCurrent()) throw new Error('Preview retired');
          const result = await client.storage
            .from('inventory-files')
            .download(photo.path, {}, { signal, cache: 'no-store' });
          if (
            alive &&
            !signal.aborted &&
            scopeCurrent() &&
            result.error &&
            'statusCode' in result.error &&
            ['401', '403'].includes(String(result.error.statusCode))
          )
            cache.accessLost();
          return result;
        },
        deadline,
        controller.signal,
      )
      .then(({ data, error }) => {
        if (!alive || !scopeCurrent()) return;
        if (error) {
          return;
        }
        if (!data) return;
        objectUrl = URL.createObjectURL(data);
        setImage({ path: photo.path, url: objectUrl });
      })
      .catch(() => {});
    return () => {
      unsubscribe();
      retire();
    };
  }, [client, photo.path, cache, deadline, scopeCurrent, subscribeClose]);
  return image?.path === photo.path ? (
    // Authenticated Storage blob only; no durable or signed URL in the cache.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.photo} src={image.url} alt={photo.name} />
  ) : null;
}

/** Owns interactions around a native link; never nests controls inside it. */
export function PeekAnchor({
  target,
  children,
}: {
  target: PeekTarget | null;
  children: PeekChildren;
}) {
  const scope = usePeekScope();
  return scope && target ? (
    <ScopedPeekAnchor
      key={JSON.stringify([scope.scopeKey, peekKey(target)])}
      target={target}
      scope={scope}
    >
      {children}
    </ScopedPeekAnchor>
  ) : typeof children === 'function' ? (
    children({})
  ) : (
    children
  );
}
function ScopedPeekAnchor({
  target,
  children,
  scope,
}: {
  target: PeekTarget;
  children: PeekChildren;
  scope: NonNullable<ReturnType<typeof usePeekScope>>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timers = useRef<{
    hover?: ReturnType<typeof setTimeout>;
    close?: ReturnType<typeof setTimeout>;
  }>({});
  const touch = useRef(false);
  const pointerFocus = useRef(false);
  const [payload, setPayload] = useState<PeekPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 350 });
  const dismissed = useRef(false);
  const privacy = usePrivacyReadiness();
  const generation = useRef(0);
  const pathname = usePathname();
  const subscribeClose = scope.subscribeClose;
  const key = JSON.stringify(target);
  const clearTimers = useCallback(() => {
    clearTimeout(timers.current.hover);
    clearTimeout(timers.current.close);
  }, []);
  const close = useCallback(() => {
    clearTimers();
    generation.current++;
    setPayload(null);
    scope.retire(id);
  }, [clearTimers, scope, id]);
  const reset = useCallback(() => {
    if (card.current) {
      card.current.hidden = true;
      card.current.setAttribute('inert', '');
    }
    clearTimers();
    generation.current++;
    setPayload(null);
    setLoading(false);
    setFailed(false);
  }, [clearTimers]);
  const withdraw = useCallback(() => {
    reset();
    scope.retire(id, true);
  }, [reset, scope, id]);
  const admitted = useStrictPresentation(
    anchor,
    JSON.stringify([key, scope.cache.actor, scope.cache.backend]),
    withdraw,
  );
  const triggerCurrent = useCallback(() => {
    const link = anchor.current?.querySelector('a') ?? null;
    return (
      scope.current() &&
      admitted() &&
      strictPresentationCurrent(privacy, link) &&
      renderedPresentation(link)
    );
  }, [scope, admitted, privacy]);
  const open =
    scope.active === id &&
    pathname !== peekHref(target) &&
    scope.current() &&
    strictPresentationCurrent(
      privacy,
      typeof document === 'undefined'
        ? null
        : (document.getElementById(id + '-trigger')?.querySelector('a') ??
            null),
    );
  const obstructionChanged = usePeekObstruction(
    card,
    triggerCurrent,
    subscribeClose,
    open,
  );
  const begin = useCallback(() => {
    if (dismissed.current || !triggerCurrent() || pathname === peekHref(target))
      return;
    clearTimers();
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 24);
    const top = Math.max(
      12,
      Math.min(rect.bottom + 8, window.innerHeight - 350),
    );
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top,
      maxHeight: window.innerHeight - top - 12,
    });
    const deadline = Date.now() + 5000;
    scope.activate(id, deadline);
    const token = ++generation.current;
    setPayload(scope.cache.get(target));
    setLoading(true);
    setFailed(false);
    void scope.cache
      .revalidate(target, deadline, triggerCurrent)
      .then((value) => {
        if (generation.current === token && triggerCurrent()) {
          setPayload(value);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (generation.current !== token || !triggerCurrent()) return;
        setLoading(false);
        if (error instanceof PeekAccessLost) {
          setPayload(null);
          close();
        } else {
          setPayload(scope.cache.get(target));
          setFailed(true);
        }
      });
  }, [clearTimers, close, id, pathname, scope, target, triggerCurrent]);
  useEffect(() => {
    if (!open || !payload) return;
    const timer = setTimeout(() => {
      setPayload(null);
      setFailed(true);
    }, scope.cache.expiresIn(target));
    return () => clearTimeout(timer);
  }, [open, payload, scope.cache, target]);
  const leaving = useCallback(() => {
    clearTimeout(timers.current.hover);
    timers.current.close = setTimeout(() => {
      if (
        anchor.current?.contains(document.activeElement) ||
        card.current?.contains(document.activeElement)
      )
        return;
      close();
    }, 180);
  }, [close]);
  useEffect(() => {
    const currentTimers = timers.current;
    const generationCounter = generation;
    const keyboard = () => {
      touch.current = false;
      pointerFocus.current = false;
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      generationCounter.current++;
      clearTimeout(currentTimers.hover);
      clearTimeout(currentTimers.close);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, []);
  useEffect(
    () =>
      subscribeClose(() => {
        reset();
      }),
    [subscribeClose, reset],
  );
  useEffect(() => {
    if (!open) {
      generation.current++;
    }
  }, [open, key]);
  useEffect(() => {
    if (!open) return;
    const checkTrigger = () => {
      if (!triggerCurrent()) withdraw();
    };
    const observer = new MutationObserver(checkTrigger);
    for (
      let node: Element | null = anchor.current?.querySelector('a') ?? null;
      node;
      node = node.parentElement
    )
      observer.observe(node, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'inert', 'open'],
      });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissed.current = true;
        const inside = card.current?.contains(document.activeElement);
        close();
        if (inside)
          anchor.current?.querySelector<HTMLAnchorElement>('a')?.focus();
      }
    };
    const leaveViewport = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !card.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', leaveViewport, true);
    window.addEventListener('resize', leaveViewport);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', leaveViewport, true);
      window.removeEventListener('resize', leaveViewport);
    };
  });
  const trigger: PeekTriggerProps = {
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onPointerDown: useCallback(
      (event) => {
        pointerFocus.current = true;
        touch.current = event.pointerType === 'touch';
        if (touch.current) close();
      },
      [close],
    ),
    onPointerEnter: useCallback(
      (event) => {
        clearTimeout(timers.current.close);
        if (
          !open &&
          event.pointerType === 'mouse' &&
          window.matchMedia('(hover: hover) and (pointer: fine)').matches
        ) {
          dismissed.current = false;
          timers.current.hover = setTimeout(begin, 400);
        }
      },
      [begin, open],
    ),
    onPointerLeave: useCallback(() => leaving(), [leaving]),
    onFocus: useCallback(() => {
      clearTimeout(timers.current.close);
      if (!touch.current && !pointerFocus.current && !open) begin();
    }, [begin, open]),
    onBlur: useCallback(
      (event) => {
        pointerFocus.current = false;
        if (
          !(event.relatedTarget instanceof Node) ||
          (!anchor.current?.contains(event.relatedTarget) &&
            !card.current?.contains(event.relatedTarget))
        )
          dismissed.current = false;
        leaving();
      },
      [leaving],
    ),
    onKeyDown: useCallback(
      (event) => {
        touch.current = false;
        if (event.key === 'Tab' && !event.shiftKey && open) {
          const control = card.current?.querySelector<HTMLAnchorElement>('a');
          if (control) {
            event.preventDefault();
            control.focus();
          }
        }
        if (!open && event.key === 'ArrowDown') {
          dismissed.current = false;
          event.preventDefault();
          begin();
        }
      },
      [begin, open],
    ),
    onClick: useCallback(() => close(), [close]),
  };
  // These closures are only forwarded to native event props. The render callback
  // constructs trigger JSX; compose creates functions without invoking handlers
  // or reading their captured refs. Keep this exemption confined to decoration.
  /* eslint-disable react-hooks/refs */
  let link: ReactNode;
  if (typeof children === 'function') link = children(trigger);
  else if (isValidElement(children)) {
    const element = children as ReactElement<PeekTriggerProps>;
    link = cloneElement(element, {
      ...trigger,
      onPointerDown: compose(
        element.props.onPointerDown,
        trigger.onPointerDown,
      ),
      onPointerEnter: compose(
        element.props.onPointerEnter,
        trigger.onPointerEnter,
      ),
      onPointerLeave: compose(
        element.props.onPointerLeave,
        trigger.onPointerLeave,
      ),
      onFocus: compose(element.props.onFocus, trigger.onFocus),
      onBlur: compose(element.props.onBlur, trigger.onBlur),
      onKeyDown: compose(element.props.onKeyDown, trigger.onKeyDown),
      onClick: compose(element.props.onClick, trigger.onClick),
    });
  } else link = children;
  /* eslint-enable react-hooks/refs */
  return (
    <>
      <span id={id + '-trigger'} ref={anchor} className={styles.anchor}>
        {link}
      </span>
      {open &&
        createPortal(
          <SpringPresence
            id={id}
            open={true}
            instanceKey={key}
            kind="popover"
            surfaceRef={card}
            onPresentationChange={obstructionChanged}
            role="dialog"
            aria-modal="false"
            aria-label="Current details preview"
            className={styles.card}
            style={position}
            onPointerEnter={() => clearTimeout(timers.current.close)}
            onPointerLeave={leaving}
            onFocus={() => clearTimeout(timers.current.close)}
            onBlur={leaving}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              if (
                event.shiftKey &&
                event.target === card.current?.querySelector('a')
              ) {
                event.preventDefault();
                anchor.current?.querySelector<HTMLAnchorElement>('a')?.focus();
              }
              if (
                !event.shiftKey &&
                event.target === card.current?.querySelector('button')
              ) {
                if (
                  focusAfterPeek(
                    anchor.current?.querySelector('a') ?? null,
                    card.current,
                  )
                ) {
                  event.preventDefault();
                  close();
                }
              }
            }}
          >
            <p className={styles.caption}>Current details</p>
            {payload ? (
              <>
                <strong className={styles.name}>{payload.name}</strong>
                <p>
                  {target.kind === 'asset'
                    ? 'Individual asset'
                    : target.kind === 'quantity'
                      ? 'Quantity item'
                      : 'Storage location'}{' '}
                  · {recordStatusLabel(payload.status)}
                </p>
                {payload.photo && (
                  <RecognitionPhoto
                    key={payload.photo.path}
                    photo={payload.photo}
                    scope={{ ...scope, current: triggerCurrent }}
                  />
                )}
                {target.kind === 'asset' && (
                  <p>Asset tag: {payload.assetTag || 'Untagged'}</p>
                )}
                {payload.stock && (
                  <p>
                    {payload.stock.available} available in storage ·{' '}
                    {payload.stock.assigned} assigned to sites ·{' '}
                    {payload.stock.recorded} recorded
                  </p>
                )}
                {payload.siteName && (
                  <p>Assigned to {payload.siteName} · no room model</p>
                )}
                {payload.locations.map((location) => (
                  <div key={location.code}>
                    <p>
                      {payload.status === 'retired'
                        ? 'Last recorded storage: '
                        : ''}
                      {location.breadcrumb}
                      {!location.active ? ' (inactive)' : ''}
                    </p>
                    {target.kind === 'location' && (
                      <p>
                        {location.canHold
                          ? 'Can hold inventory'
                          : 'Navigation location'}
                      </p>
                    )}
                    <ShowInRoom location={location} />
                  </div>
                ))}
                {payload.moreLocations && (
                  <p>More storage locations on the record.</p>
                )}
                {target.kind !== 'location' &&
                  !payload.siteName &&
                  !payload.locations.length && (
                    <p>
                      {payload.stock?.assigned !== '0' &&
                      payload.stock?.assigned
                        ? 'Stock is assigned to sites; no positive storage holding.'
                        : 'No current storage location.'}
                    </p>
                  )}
              </>
            ) : loading ? (
              <div aria-busy="true">
                <LoadingSkeleton label="Loading current details" />
              </div>
            ) : (
              <p>Current details are unavailable.</p>
            )}
            {failed && payload && (
              <p role="status">
                Latest details could not be checked. Open the record to refresh.
              </p>
            )}
            <Link
              href={peekHref(target)}
              onClick={close}
              className="inline-flex min-h-11 items-center text-cyan-300 underline"
            >
              {target.kind === 'location' ? 'Open location' : 'Open record'}
            </Link>
            <button
              type="button"
              className="ml-3 min-h-11 underline"
              onClick={() => {
                dismissed.current = true;
                close();
                anchor.current?.querySelector<HTMLAnchorElement>('a')?.focus();
              }}
            >
              Close preview
            </button>
          </SpringPresence>,
          document.body,
        )}
    </>
  );
}
export function PeekLink({
  peekTarget,
  children,
  ...props
}: ComponentProps<typeof Link> & { peekTarget: PeekTarget }) {
  return (
    <PeekAnchor target={peekTarget}>
      <Link {...props}>{children}</Link>
    </PeekAnchor>
  );
}
