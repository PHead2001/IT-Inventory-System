'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useEffectEvent,
  useEffect,
} from 'react';
import type { createRouteReadiness } from './route-readiness';
import { RouteContentIdentityContext } from './route-content-identity';
import { afterTransitionCapture } from '@/components/forms/transition-capture';
import { PairedInventoryContent } from './paired-inventory-content';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from './presentation-privacy';
import { replaceAppHistoryUrl } from '@/lib/navigation/history';
import type { createRouteCommandState } from './route-command-state';
import { routeKey as keyOf } from './route-key';
import { RoutePendingContext } from './route-pending';
import { createNativeTaskHandoff, type TaskSource } from './route-task-handoff';
import {
  assignmentEpoch,
  readAuthoritativeCleanupRevision,
  subscribeAuthoritativeCleanup,
  subscribePrivacyRevocation,
  subscribeAssignmentInvalidation,
} from '@/features/scan/assign-batch';
export const RouteNavigationIdentityContext = createContext<{
  state: ReturnType<typeof createRouteCommandState>;
  committedRouteKey: string;
} | null>(null);
const noopSubscribe = () => () => {};
const initialIdentity = () => 0;

const RouteTaskConsumptionContext = createContext<
  ((recordPath: string, task: string, source: HTMLElement) => boolean) | null
>(null);
export function useConsumeRouteTask() {
  return useContext(RouteTaskConsumptionContext);
}

export const RouteReadyContext = createContext<ReturnType<
  typeof createRouteReadiness
> | null>(null);
export function RouteReady({
  actorId,
  routeKey,
  contentIdentity,
  pairingHref,
  children,
  ready = true,
  pairedInventory = false,
  conventionalPrimary = false,
}: {
  actorId: string;
  routeKey: string;
  contentIdentity: string;
  /** Canonical result scope for title pairing only; never readiness authority. */
  pairingHref?: string;
  children: React.ReactNode;
  ready?: boolean;
  /** Explicit opt-in for successful list/quantity/asset primaries, never fallback. */
  pairedInventory?: boolean;
  /** Successful conventional primary capability, never canvas/loading/error. */
  conventionalPrimary?: boolean;
}) {
  const readiness = useContext(RouteReadyContext);
  const root = useRef<HTMLDivElement>(null);
  const privacy = usePrivacyReadiness();
  const authority = useRef(privacy);
  const navigation = useContext(RouteNavigationIdentityContext);
  const pending = useContext(RoutePendingContext);
  const [nativeTask] = useState(createNativeTaskHandoff);
  const navigationIdentity = useSyncExternalStore(
    navigation?.state.subscribe ?? noopSubscribe,
    navigation?.state.navigationIdentity ?? initialIdentity,
    initialIdentity,
  );
  const [consumed, setConsumed] = useState<{
    sourceKey: string;
    destinationKey: string;
    navigationIdentity: number;
  } | null>(null);
  const [sourceKey, setSourceKey] = useState(routeKey);
  if (sourceKey !== routeKey) {
    setSourceKey(routeKey);
    // A server update to the explicit destination retains this same-primary
    // handoff. A later deliberate source URL is a new task intent.
    if (consumed && routeKey !== consumed.destinationKey) setConsumed(null);
  }
  const effective =
    sourceKey === routeKey && consumed?.sourceKey === routeKey
      ? consumed.destinationKey
      : routeKey;
  const taskSource = (): TaskSource | null => {
    if (!root.current || !navigation || !pending) return null;
    const privacy = authority.current;
    const snapshot = pending.state.snapshot();
    const currentNavigation = navigation.state.navigationIdentity();
    const destination = navigation.state.navigationDestination();
    return {
      root: root.current,
      actorId,
      contentIdentity,
      serverAnchor: routeKey,
      cleanKey: effective,
      navigationIdentity: currentNavigation,
      securityRevision: JSON.stringify([
        privacy.generation,
        privacy.cleanupRevision,
        privacy.revocationRevision,
        privacy.verifiedEpoch,
        assignmentEpoch(),
        readAuthoritativeCleanupRevision(),
      ]),
      pendingEpoch: snapshot.epoch,
      committedKey: navigation.committedRouteKey,
      fresh: freshPresentationGrant(privacy),
      idle:
        !snapshot.pending &&
        pending.state.current(snapshot.epoch) &&
        readiness?.nativeTaskIdle() === true &&
        (destination === null ||
          destination === navigation.committedRouteKey ||
          consumed?.navigationIdentity === currentNavigation),
      visible:
        ready &&
        root.current.isConnected &&
        !root.current.closest('[hidden], [inert]') &&
        Array.from(root.current.children).some(
          (child) =>
            child.getClientRects().length > 0 &&
            getComputedStyle(child).visibility !== 'hidden',
        ),
    };
  };
  const observeTaskSource = useEffectEvent(() => {
    const source = taskSource();
    const primary = readiness?.currentPrimary();
    if (source)
      nativeTask.observe(
        source,
        primary?.root === source.root &&
          primary.actorId === actorId &&
          primary.contentIdentity === contentIdentity &&
          primary.routeKey === source.cleanKey &&
          source.committedKey ===
            keyOf(location.pathname, new URLSearchParams(location.search)),
      );
    else nativeTask.retire();
  });
  useEffect(() => {
    const retire = () => nativeTask.retire();
    let epoch = pending?.state.snapshot().epoch;
    const stopPending = pending?.state.subscribe(() => {
      if (
        pending.state.snapshot().pending ||
        pending.state.snapshot().epoch !== epoch
      )
        retire();
      epoch = pending.state.snapshot().epoch;
    });
    let identity = navigation?.state.navigationIdentity();
    const stopNavigation = navigation?.state.subscribe(() => {
      const next = navigation.state.navigationIdentity();
      if (next !== identity) retire();
      identity = next;
    });
    const stopCleanup = subscribeAuthoritativeCleanup(retire);
    const stopRevocation = subscribePrivacyRevocation(retire);
    const stopAssignment = subscribeAssignmentInvalidation(retire);
    window.addEventListener('popstate', retire);
    return () => {
      retire();
      stopPending?.();
      stopNavigation?.();
      stopCleanup();
      stopRevocation();
      stopAssignment();
      window.removeEventListener('popstate', retire);
    };
  }, [nativeTask, pending, navigation?.state]);
  const rearmConsumed = useEffectEvent(() => {
    if (
      consumed &&
      ready &&
      root.current?.isConnected &&
      !root.current.closest('[hidden], [inert]') &&
      freshPresentationGrant(authority.current) &&
      consumed.navigationIdentity !== navigationIdentity &&
      navigation?.state.navigationDestination() === consumed.sourceKey &&
      navigation.committedRouteKey === consumed.sourceKey &&
      routeKey === consumed.sourceKey &&
      keyOf(location.pathname, new URLSearchParams(location.search)) ===
        routeKey &&
      Array.from(root.current.children).some(
        (child) =>
          child.getClientRects().length > 0 &&
          getComputedStyle(child).visibility !== 'hidden',
      )
    ) {
      setConsumed(null);
      return true;
    }
    return false;
  });
  useInsertionEffect(() => {
    authority.current = privacy;
  }, [privacy]);
  // This identity travels with the server primary. Next's opaque layout slot
  // can replace its children before an outer accepted pathname catches up.
  const identity = useMemo(
    () => ({
      pathname: routeKey.split('?')[0],
      listHref: pairingHref ?? routeKey,
      rawRouteKey: effective,
    }),
    [routeKey, effective, pairingHref],
  );
  // A committed primary registers its full effective key. Privacy reconciliation
  // cannot rearm a task alias without its exact new navigation destination and
  // matching React router commit, including cache reuse without Activity changes.
  useLayoutEffect(() => {
    if (rearmConsumed()) return;
    if (!ready || !root.current || !readiness) {
      nativeTask.retire();
      return;
    }
    const committedRoot = root.current;
    let unregister: (() => void) | undefined;
    const cancel = afterTransitionCapture(committedRoot.ownerDocument, () => {
      unregister = readiness.register({
        actorId,
        routeKey: effective,
        contentIdentity,
        root: committedRoot,
        ...(consumed &&
        (consumed.sourceKey === routeKey ||
          consumed.destinationKey === routeKey)
          ? {
              consumedTask: {
                sourceKey: consumed.sourceKey,
                destinationKey: consumed.destinationKey,
              },
            }
          : {}),
        conventionalPrimary,
      });
      observeTaskSource();
    });
    return () => {
      cancel();
      unregister?.();
    };
  });
  return (
    <RouteTaskConsumptionContext
      value={(recordPath, task, source) => {
        if (
          !ready ||
          !root.current ||
          !root.current.contains(source) ||
          !source.isConnected ||
          source.closest('[hidden], [inert]') ||
          source.getClientRects().length === 0 ||
          getComputedStyle(source).visibility === 'hidden' ||
          !freshPresentationGrant(authority.current)
        )
          return false;
        const handoff =
          readiness?.consumeTask(
            root.current,
            effective,
            recordPath,
            task,
            replaceAppHistoryUrl,
          ) ??
          readiness?.consumeNativeTask(root.current, effective, () => {
            const source = taskSource();
            return source
              ? nativeTask.consume(
                  source,
                  recordPath,
                  task,
                  replaceAppHistoryUrl,
                )
              : null;
          });
        if (!handoff) return false;
        setConsumed({
          ...handoff,
          navigationIdentity,
        });
        return true;
      }}
    >
      <RouteContentIdentityContext value={identity}>
        <div ref={root} data-route-ready="true" style={{ display: 'contents' }}>
          {pairedInventory || conventionalPrimary ? (
            <PairedInventoryContent
              enabled={ready}
              conventionalPrimary={conventionalPrimary}
            >
              {children}
            </PairedInventoryContent>
          ) : (
            children
          )}
        </div>
      </RouteContentIdentityContext>
    </RouteTaskConsumptionContext>
  );
}
