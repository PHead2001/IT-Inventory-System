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
import {
  InventoryCaptureGroup,
  InventoryCaptureRegionsContext,
} from './inventory-capture-region';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import { RoutePresentationSourceContext } from './route-presentation-source';

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
  capture = 'body',
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
  /** Explicit canvas-free sibling regions under this one canonical owner. */
  capture?: 'body' | 'regions';
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
        readiness?.nativeTaskIdle() === true,
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
    const destination = navigation?.state.navigationDestination();
    if (source)
      nativeTask.observe(
        source,
        navigation?.state.navigationOrigin() !== 'history' &&
          (destination === null ||
            destination === source.committedKey ||
            consumed?.navigationIdentity === source.navigationIdentity) &&
          primary?.root === source.root &&
          primary.actorId === actorId &&
          primary.contentIdentity === contentIdentity &&
          primary.routeKey === source.cleanKey &&
          source.committedKey ===
            keyOf(location.pathname, new URLSearchParams(location.search)),
      );
    else nativeTask.retire();
  });
  const observeSettledTaskSource = useEffectEvent((current: () => boolean) => {
    const expected = taskSource();
    const href = location.href;
    if (
      !expected?.fresh ||
      !expected.visible ||
      new URL(href).searchParams.has('task')
    )
      return;
    // Store listeners can synchronously commit/withdraw a primary. Observe only
    // after that notification finishes, without acknowledging or settling it.
    queueMicrotask(() => {
      if (!current()) return;
      const source = taskSource();
      if (
        !source ||
        source.root !== expected.root ||
        source.actorId !== expected.actorId ||
        source.contentIdentity !== expected.contentIdentity ||
        source.serverAnchor !== expected.serverAnchor ||
        source.navigationIdentity !== expected.navigationIdentity ||
        source.securityRevision !== expected.securityRevision ||
        source.pendingEpoch !== expected.pendingEpoch
      )
        return;
      const before = new URL(href);
      const now = new URL(location.href);
      if (
        keyOf(before.pathname, before.searchParams) !==
        keyOf(now.pathname, now.searchParams)
      ) {
        nativeTask.retire();
        return;
      }
      observeTaskSource();
    });
  });
  useEffect(() => {
    let live = true;
    let observation = 0;
    const retire = () => nativeTask.retire();
    let previous = pending?.state.snapshot();
    const stopPending = pending?.state.subscribe(() => {
      const next = pending.state.snapshot();
      const token = ++observation;
      const settled =
        previous?.pending && !next.pending && previous.epoch === next.epoch;
      if (next.pending || next.epoch !== previous?.epoch) retire();
      previous = next;
      if (settled)
        observeSettledTaskSource(
          () =>
            live &&
            observation === token &&
            pending.state.current(next.epoch) &&
            pending.state.snapshot().epoch === next.epoch &&
            !pending.state.snapshot().pending,
        );
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
      live = false;
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
  const auxiliary = useContext(AuxiliaryRouteCaptureContext);
  const source = useContext(RoutePresentationSourceContext);
  useLayoutEffect(() => {
    if (!ready || !pairedInventory || !root.current || !source || !auxiliary)
      return;
    // Identity only. The existing canonical readiness owner still decides which
    // root is accepted; no new presentation source or acknowledgment is created.
    // Match its effective accepted key after task consumption; the immutable
    // server anchor remains separate in the native task guard above.
    return auxiliary.registerSource(root.current, effective, source);
  }, [
    auxiliary,
    source,
    effective,
    ready,
    pairedInventory,
    conventionalPrimary,
  ]);
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
          {capture === 'regions' ||
          (auxiliary && (pairedInventory || conventionalPrimary)) ? (
            <InventoryCaptureRegionsContext
              value={{ enabled: ready, pairedInventory, conventionalPrimary }}
            >
              {capture === 'regions' ? (
                children
              ) : (
                <InventoryCaptureGroup
                  region="body"
                  className="experience-paired-inventory-content"
                >
                  {children}
                </InventoryCaptureGroup>
              )}
            </InventoryCaptureRegionsContext>
          ) : pairedInventory || conventionalPrimary ? (
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
