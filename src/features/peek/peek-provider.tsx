'use client';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useStrictPresentation } from '@/components/experience/strict-presentation';
import { useRouteCommandBoundary } from '@/components/experience/route-motion';
import { RoutePresentationLifetimeContext } from '@/components/experience/route-presentation-source';
import { observeRouteSnapshotWithdrawal } from '@/components/experience/route-motion-state';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { PeekCache } from './cache';
import { peekInvalidationEvent } from './invalidation';

function createPeekOwner(actor: string, backend: string) {
  const listeners = new Set<() => void>();
  const closes = new Set<() => void>();
  let admitted = () => false;
  let denied = false;
  let identity = JSON.stringify([actor, backend]);
  let verification = '';
  let route = '';
  let ownershipRevision = 0;
  let cache = new PeekCache(actor, backend, () => withdraw(true));
  let snapshot = {
    cache,
    active: null as string | null,
    deadline: 0,
    route,
    verification,
  };
  const publish = (active: string | null = null, deadline = 0) => {
    if (
      snapshot.cache === cache &&
      snapshot.active === active &&
      snapshot.deadline === deadline &&
      snapshot.route === route &&
      snapshot.verification === verification
    )
      return;
    snapshot = { cache, active, deadline, route, verification };
    listeners.forEach((listener) => listener());
  };
  const current = () => !denied && admitted();
  function withdraw(accessLost = false) {
    ownershipRevision++;
    if (accessLost) denied = true;
    cache.clear();
    closes.forEach((listener) => listener());
    publish();
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeClose(listener: () => void) {
      closes.add(listener);
      return () => {
        closes.delete(listener);
      };
    },
    current,
    captureCurrent() {
      const accepted = current();
      const capturedCache = cache;
      const capturedVerification = verification;
      const capturedRoute = route;
      const capturedRevision = ownershipRevision;
      return () =>
        accepted &&
        current() &&
        ownershipRevision === capturedRevision &&
        cache === capturedCache &&
        verification === capturedVerification &&
        route === capturedRoute;
    },
    withdraw,
    configure(
      nextActor: string,
      nextBackend: string,
      nextRoute: string,
      nextVerification: string,
      nextCurrent: () => boolean,
    ) {
      const nextIdentity = JSON.stringify([nextActor, nextBackend]);
      if (identity !== nextIdentity) {
        withdraw();
        cache.dispose();
        identity = nextIdentity;
        cache = new PeekCache(nextActor, nextBackend, () => withdraw(true));
      }
      if (route !== nextRoute || verification !== nextVerification) withdraw();
      if (verification !== nextVerification) denied = false;
      route = nextRoute;
      verification = nextVerification;
      admitted = nextCurrent;
      cache.configureCurrent(current);
      publish(snapshot.active, snapshot.deadline);
    },
    activate(id: string | null, deadline = 0) {
      closes.forEach((listener) => listener());
      if (!id || !current()) publish();
      else publish(id, deadline);
    },
    retire(id: string, discard = false) {
      // A hidden/unmounted trigger never cancels a different link's owner.
      if (snapshot.active !== id) return;
      if (discard) cache.clear();
      else cache.cancel();
      closes.forEach((listener) => listener());
      publish();
    },
    connect() {
      cache.resume();
      return () => {
        withdraw();
        cache.dispose();
      };
    },
  };
}
type Owner = ReturnType<typeof createPeekOwner>;
type Scope = Pick<
  Owner,
  'current' | 'captureCurrent' | 'activate' | 'retire' | 'subscribeClose'
> &
  ReturnType<Owner['snapshot']> & { scopeKey: string };
const Context = createContext<Scope | null>(null);
export const usePeekScope = () => useContext(Context);
export function PeekProvider({
  actor,
  backend,
  children,
}: {
  actor: string;
  backend: string;
  children: ReactNode;
}) {
  const privacy = usePrivacyReadiness();
  const host = useRef<HTMLDivElement>(null);
  const route = JSON.stringify([
    usePathname(),
    useSearchParams()?.toString() ?? '',
  ]);
  const verification = JSON.stringify([
    actor,
    backend,
    privacy.generation,
    privacy.verifiedEpoch,
    privacy.revocationRevision,
  ]);
  // Only admission is replaced. Provider children keep their mounted drafts.
  const scopeKey = JSON.stringify([actor, backend, route, verification]);
  const owner = useMemo(
    () => ({ ...createPeekOwner(actor, backend), scopeKey }),
    [actor, backend, scopeKey],
  );
  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.snapshot,
    owner.snapshot,
  );
  return (
    <Context
      value={{
        ...snapshot,
        scopeKey,
        active:
          snapshot.route === route &&
          snapshot.verification === verification &&
          snapshot.cache.actor === actor &&
          snapshot.cache.backend === backend
            ? snapshot.active
            : null,
        current: owner.current,
        captureCurrent: owner.captureCurrent,
        activate: owner.activate,
        retire: owner.retire,
        subscribeClose: owner.subscribeClose,
      }}
    >
      <div ref={host} className="contents">
        <PeekAdmission
          key={scopeKey}
          owner={owner}
          host={host}
          actor={actor}
          backend={backend}
          route={route}
          verification={verification}
        />
        {children}
      </div>
    </Context>
  );
}

/** Original-scope strict controller; its cleanup runs before successor admission. */
function PeekAdmission({
  owner,
  host,
  actor,
  backend,
  route,
  verification,
}: {
  owner: Owner;
  host: RefObject<HTMLDivElement | null>;
  actor: string;
  backend: string;
  route: string;
  verification: string;
}) {
  const lifetime = useContext(RoutePresentationLifetimeContext);
  const routeAuthority = useRouteCommandBoundary(actor, backend);
  const [client] = useState(createSupabaseBrowserClient);
  const withdraw = useCallback(() => owner.withdraw(), [owner]);
  const current = useStrictPresentation(
    host,
    JSON.stringify([actor, backend, route]),
    withdraw,
  );
  const admitted = useCallback(
    () => current() && (!lifetime || routeAuthority.authorized()),
    [current, lifetime, routeAuthority],
  );
  useLayoutEffect(() => {
    owner.configure(actor, backend, route, verification, admitted);
  });
  useLayoutEffect(() => owner.connect(), [owner]);
  useLayoutEffect(() => {
    if (!lifetime) return;
    const reconcile = () => {
      if (!routeAuthority.authorized()) owner.withdraw();
    };
    const unsubscribe = routeAuthority.subscribe(reconcile);
    const stop = observeRouteSnapshotWithdrawal(() => owner.withdraw());
    return () => {
      unsubscribe();
      stop();
    };
  }, [lifetime, owner, routeAuthority]);
  useLayoutEffect(() => {
    let live = true;
    window.addEventListener(peekInvalidationEvent, withdraw);
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!live || owner.snapshot().verification !== verification) return;
      if (event === 'SIGNED_OUT' || !session || session.user.id !== actor)
        owner.withdraw(true);
    });
    return () => {
      live = false;
      window.removeEventListener(peekInvalidationEvent, withdraw);
      data.subscription.unsubscribe();
    };
  }, [actor, verification, client, owner, withdraw]);
  return null;
}
