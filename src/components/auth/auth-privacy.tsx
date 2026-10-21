'use client';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  readLogoutPrivacyGeneration,
  readProtectedPrivacyIdentity,
} from '@/lib/auth/privacy-read-transport';
import { routeKey } from '@/components/experience/route-key';
import {
  createPrivacyNavigationTickets,
  type PrivacyNavigationTicket,
  type PrivacyNavigationView,
} from './privacy-navigation-ticket';
import {
  taskQueryDestination,
  controllerTaskContinuity,
  type PrivacyTaskQueryContinuity,
} from './privacy-task-query';
import {
  protectedBindingKey,
  type ProtectedPrivacyBinding,
} from '@/lib/auth/protected-binding';
import {
  assignmentEpoch,
  readAuthoritativeCleanupRevision,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
  subscribePrivacyRevocation,
  subscribeAssignmentInvalidation,
} from '@/features/scan/assign-batch';
import type {
  LogoutPrivacyGeneration,
  LogoutPrivacyReceipt,
} from '@/lib/auth/privacy-barrier';
import {
  cleanupIssue,
  reminderIssue,
  verifyTabPrivacy,
} from './privacy-cleanup';
import {
  PrivacyReadinessContext,
  useAuthoritativeCleanupRevision,
  usePrivacyRevocationRevision,
  useAssignmentInvalidationRevision,
} from './privacy-readiness';
import { AcceptedPrivacyContent } from './privacy-content';
import {
  createPrivateDocumentTitleController,
  PrivateDocumentTitleContext,
} from './private-document-title';

export function CleanupStatus({
  issue,
  retry,
  retainedOwner = false,
  retryLabel = 'Retry privacy cleanup',
}: {
  issue: string;
  retry: () => void;
  retainedOwner?: boolean;
  retryLabel?: string;
}) {
  return (
    <div className="space-y-5">
      <p role={issue ? 'alert' : 'status'}>
        {issue || 'Clearing private data from this tab…'}
      </p>
      {issue && (
        <Button type="button" onClick={retry}>
          {retryLabel}
        </Button>
      )}
      {retainedOwner && (
        <p>
          Restore this workspace’s original account access and retry. Keep this
          page open if an outcome is still unknown. You can{' '}
          <a
            href="/inventory"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            open Inventory in a new tab
          </a>{' '}
          to use the current account without replacing this page’s recovery.
        </p>
      )}
    </div>
  );
}

type PrivacyRouteKey = {
  navigation: string;
  serverRevision: string | undefined;
  revision: unknown;
  bindingRevision: string;
};
type TaskQueryOperation = {
  identity: symbol;
  parent: symbol | null;
  kind: 'task' | 'cleanup';
  capture: Readonly<{
    sourceKey: string;
    destinationKey: string;
    cleanKey: string;
    binding: string;
    serverRevision: string | undefined;
    revision: unknown;
    generation: string;
    revocation: number;
    callbacks: number;
    cleanup: number;
    request: number;
    securityRevision: string;
  }>;
  status: () => 'prepared' | 'pending' | 'verified' | 'consumed' | 'retired';
  setStatus: (status: ReturnType<TaskQueryOperation['status']>) => void;
};
function taskQueryOperation(
  capture: TaskQueryOperation['capture'],
  parent: symbol | null,
  kind: TaskQueryOperation['kind'],
): TaskQueryOperation {
  let status: ReturnType<TaskQueryOperation['status']> = 'prepared';
  return {
    identity: Symbol(),
    capture,
    parent,
    kind,
    status: () => status,
    setStatus: (next) => {
      status = next;
    },
  };
}
const matchingKey = (left: PrivacyRouteKey | null, right: PrivacyRouteKey) =>
  left?.navigation === right.navigation &&
  left.serverRevision === right.serverRevision &&
  left.revision === right.revision &&
  left.bindingRevision === right.bindingRevision;

type BoundaryProps = {
  children: ReactNode | ((generation: string) => ReactNode);
  revision?: unknown;
  serverGeneration?: LogoutPrivacyGeneration;
};
/** Suspense supports query-aware readiness on otherwise static Auth routes. */
export function AuthPrivacyBoundary(props: BoundaryProps) {
  return (
    <Suspense fallback={<p role="status">Checking this tab’s private data…</p>}>
      <PrivacyController {...props} />
    </Suspense>
  );
}
/** Always pass the opaque server route slot through so its status can settle. */
export function ProtectedPrivacyBoundary(
  props: Omit<BoundaryProps, 'children'> & {
    children: ReactNode;
    binding: ProtectedPrivacyBinding;
  },
) {
  return <PrivacyController {...props} protectedRoute />;
}

function PrivacyController({
  children,
  revision = 0,
  serverGeneration,
  protectedRoute = false,
  binding,
}: BoundaryProps & {
  protectedRoute?: boolean;
  binding?: ProtectedPrivacyBinding;
}) {
  const pathname = usePathname() ?? '';
  const cleanupRevision = useAuthoritativeCleanupRevision();
  const revocationRevision = usePrivacyRevocationRevision();
  const callbackRevision = useAssignmentInvalidationRevision();
  const [titles] = useState(createPrivateDocumentTitleController);
  useLayoutEffect(() => {
    if (!protectedRoute) return;
    const retire = titles.mount();
    const revoke = subscribePrivacyRevocation(titles.clear);
    const invalidate = subscribeAssignmentInvalidation(titles.clear);
    return () => {
      revoke();
      invalidate();
      retire();
    };
  }, [titles, protectedRoute]);
  const [ownerBinding] = useState(binding);
  const [ownerAuthority] = useState(() => ({
    epoch: readPrivacyRevocationRevision(),
    callbacks: assignmentEpoch(),
  }));
  const bindingMatches =
    !protectedRoute ||
    (binding !== undefined &&
      ownerBinding !== undefined &&
      protectedBindingKey(binding) === protectedBindingKey(ownerBinding));
  const bindingRevision = binding ? protectedBindingKey(binding) : '';
  const query = useSearchParams()?.toString() ?? '';
  const serverRevision =
    serverGeneration?.status === 'valid'
      ? serverGeneration.generation
      : serverGeneration?.status;
  const key = useMemo(
    () => ({
      navigation: routeKey(pathname, new URLSearchParams(query)),
      serverRevision,
      revision,
      bindingRevision,
    }),
    [pathname, query, serverRevision, revision, bindingRevision],
  );
  type ControllerState = {
    ready: boolean;
    checking: boolean;
    uncertain: boolean;
    generation: string;
    issue: string;
    key: typeof key | null;
    acceptedRevocation: number | null;
    acceptedServerRevision: typeof serverRevision;
    acceptedCallbackRevision: number;
    sequence: number;
    navigationTicket:
      (NonNullable<PrivacyNavigationView> & { promise: Promise<void> }) | null;
  };
  type StateUpdate =
    ControllerState | ((previous: ControllerState) => ControllerState);
  const [state, dispatchState] = useReducer(
    (
      previous: ControllerState,
      action: { sequence: number; update: StateUpdate },
    ): ControllerState =>
      action.sequence < previous.sequence
        ? previous
        : {
            ...(typeof action.update === 'function'
              ? action.update(previous)
              : action.update),
            sequence: action.sequence,
          },
    {
      ready: false,
      checking: false,
      uncertain: false,
      generation: '',
      issue: '',
      key: null,
      acceptedRevocation: null,
      acceptedServerRevision: undefined,
      acceptedCallbackRevision: assignmentEpoch(),
      sequence: 0,
      navigationTicket: null,
    },
  );
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const serverUncertain =
    serverGeneration !== undefined &&
    (serverGeneration.status === 'invalid' ||
      serverGeneration.status === 'unavailable' ||
      (serverGeneration.status === 'absent' &&
        state.acceptedRevocation !== null &&
        state.acceptedServerRevision !== undefined &&
        state.acceptedServerRevision !== 'absent'));
  const inFlight = useRef<{
    key: typeof key;
    epoch: number;
    callbacks: number;
    request: number;
  } | null>(null);
  const handledInvalidation = useRef({
    epoch: revocationRevision,
    callbacks: callbackRevision,
  });
  const request = useRef(0);
  const setState = useCallback(
    (update: StateUpdate, sequence = request.current) => {
      dispatchState({ sequence, update });
    },
    [],
  );
  const mounted = useRef(false);
  const [tickets] = useState(createPrivacyNavigationTickets);
  const navigationProvider = useRef<symbol | null>(null);
  const configuration = useRef({
    navigation: key.navigation,
    bindingRevision,
    serverRevision,
    revision,
    bindingMatches,
  });
  const taskOperation = useRef<TaskQueryOperation | null>(null);
  // Constructing a render-local proposal does not change the live controller.
  // Insertion commits it before any descendant can observe !ready in layout.
  const [taskSlot, setTaskSlot] = useState<{
    key: PrivacyRouteKey;
    operation: TaskQueryOperation | null;
  }>(() => ({ key, operation: null }));
  let proposedTaskOperation = taskSlot.operation;
  if (!matchingKey(taskSlot.key, key)) {
    const previous = taskSlot.operation;
    const sourceKey = state.key?.navigation;
    const cleanKey = sourceKey
      ? taskQueryDestination(sourceKey, key.navigation)
      : null;
    const cleanup =
      previous?.status() === 'consumed' &&
      previous.capture.destinationKey === sourceKey &&
      previous.capture.cleanKey === key.navigation;
    if (
      !protectedRoute ||
      !bindingMatches ||
      !state.ready ||
      state.checking ||
      state.uncertain ||
      !sourceKey ||
      (!cleanKey && !cleanup) ||
      state.key?.bindingRevision !== bindingRevision ||
      state.key.serverRevision !== serverRevision ||
      state.key.revision !== revision ||
      state.acceptedRevocation !== revocationRevision ||
      state.acceptedCallbackRevision !== callbackRevision ||
      !matchingKey(state.key, taskSlot.key)
    )
      proposedTaskOperation = null;
    else {
      const capture = Object.freeze({
        sourceKey,
        destinationKey: key.navigation,
        cleanKey: cleanKey ?? key.navigation,
        binding: bindingRevision,
        serverRevision,
        revision,
        generation: state.generation,
        revocation: revocationRevision,
        callbacks: callbackRevision,
        cleanup: cleanupRevision,
        request: state.sequence + 1,
        securityRevision: JSON.stringify([
          state.generation,
          cleanupRevision,
          revocationRevision,
          callbackRevision,
          callbackRevision,
          cleanupRevision,
        ]),
      });
      proposedTaskOperation = taskQueryOperation(
        capture,
        cleanup ? previous!.identity : null,
        cleanup ? 'cleanup' : 'task',
      );
    }
    setTaskSlot({ key, operation: proposedTaskOperation });
  }
  useInsertionEffect(() => {
    if (taskOperation.current !== proposedTaskOperation) {
      if (taskOperation.current) taskOperation.current.setStatus('retired');
      taskOperation.current = proposedTaskOperation;
    }
    configuration.current = {
      navigation: key.navigation,
      bindingRevision,
      serverRevision,
      revision,
      bindingMatches,
    };
  }, [
    key.navigation,
    bindingRevision,
    serverRevision,
    revision,
    bindingMatches,
    proposedTaskOperation,
  ]);
  const taskOperationCurrent = useCallback((operation: TaskQueryOperation) => {
    const capture = operation.capture;
    const current = configuration.current;
    return (
      taskOperation.current === operation &&
      operation.status() !== 'retired' &&
      mounted.current &&
      document.visibilityState !== 'hidden' &&
      current.bindingMatches &&
      current.navigation === capture.destinationKey &&
      current.bindingRevision === capture.binding &&
      current.serverRevision === capture.serverRevision &&
      current.revision === capture.revision &&
      stateRef.current.generation === capture.generation &&
      readPrivacyRevocationRevision() === capture.revocation &&
      assignmentEpoch() === capture.callbacks &&
      readAuthoritativeCleanupRevision() === capture.cleanup &&
      (operation.status() === 'prepared'
        ? request.current + 1 === capture.request
        : request.current === capture.request)
    );
  }, []);
  const ticketCurrent = useCallback(
    (ticket: PrivacyNavigationTicket) => {
      const captured = ticket.capture;
      const current = configuration.current;
      return (
        tickets.snapshot() === ticket &&
        ticket.status !== 'retired' &&
        navigationProvider.current === captured.provider &&
        mounted.current &&
        document.visibilityState !== 'hidden' &&
        request.current === captured.request &&
        current.bindingMatches &&
        (current.navigation === captured.source ||
          current.navigation === captured.destination) &&
        current.bindingRevision === captured.binding &&
        current.serverRevision === captured.serverRevision &&
        current.revision === captured.revision &&
        stateRef.current.generation === captured.generation &&
        readPrivacyRevocationRevision() === captured.revocation &&
        assignmentEpoch() === captured.callbacks
      );
    },
    [tickets],
  );
  const cancel = useCallback(() => {
    mounted.current = false;
    request.current++;
    tickets.retire();
    if (taskOperation.current) taskOperation.current.setStatus('retired');
    setState((previous) => ({ ...previous, navigationTicket: null }));
  }, [tickets, setState]);
  const retry = useCallback(
    async (
      target = key,
      ticket?: PrivacyNavigationTicket,
      task?: TaskQueryOperation | null,
    ) => {
      if (
        taskOperation.current &&
        (taskOperation.current !== task ||
          task?.status() !== 'prepared' ||
          !taskOperationCurrent(task))
      )
        taskOperation.current.setStatus('retired');
      const epoch = readPrivacyRevocationRevision();
      const callbacks = assignmentEpoch();
      if (
        !ticket &&
        matchingKey(inFlight.current?.key ?? null, target) &&
        inFlight.current?.request === request.current &&
        inFlight.current?.epoch === epoch &&
        inFlight.current?.callbacks === callbacks
      )
        return;
      handledInvalidation.current = { epoch, callbacks };
      if (!ticket) tickets.retire();
      const attempt = ticket ? ticket.capture.request : ++request.current;
      if (
        task &&
        taskOperation.current === task &&
        task.status() === 'prepared' &&
        task.capture.request === attempt &&
        task.capture.destinationKey === target.navigation
      )
        task.setStatus('pending');
      const operation = { key: target, epoch, callbacks, request: attempt };
      inFlight.current = operation;
      const active = () =>
        mounted.current &&
        request.current === attempt &&
        readPrivacyRevocationRevision() === operation.epoch &&
        assignmentEpoch() === operation.callbacks &&
        (!ticket || ticketCurrent(ticket));
      let recoverCurrent = false;
      let needsIdentity =
        protectedRoute &&
        (!!ticket ||
          stateRef.current.uncertain ||
          (stateRef.current.acceptedRevocation ?? ownerAuthority.epoch) !==
            epoch ||
          (stateRef.current.acceptedRevocation === null
            ? ownerAuthority.callbacks
            : stateRef.current.acceptedCallbackRevision) !== callbacks ||
          !bindingMatches);
      const revoke = () => {
        if (stateRef.current.acceptedRevocation === null) return;
        if (ticket) recoverCurrent = true;
        if (
          readPrivacyRevocationRevision() ===
          stateRef.current.acceptedRevocation
        )
          revokePrivatePresentation();
        operation.epoch = readPrivacyRevocationRevision();
        operation.callbacks = assignmentEpoch();
        handledInvalidation.current = {
          epoch: operation.epoch,
          callbacks: operation.callbacks,
        };
        needsIdentity = protectedRoute;
      };
      const pauseForCleanup = () => {
        revoke();
        // verifyTabPrivacy's next synchronous step invalidates callback tickets.
        // Only that owned invalidation belongs to this verification attempt.
        operation.callbacks = assignmentEpoch() + 1;
        handledInvalidation.current = {
          epoch: operation.epoch,
          callbacks: operation.callbacks,
        };
      };
      // Native reactivation can race other updates. Publish pending readiness before
      // any newly mounted restoration consumer can enter its storage bootstrap.
      flushSync(() =>
        setState((previous) => ({
          ...previous,
          checking: true,
          issue: '',
          navigationTicket: ticket
            ? Object.freeze({
                capture: ticket.capture,
                status: 'pending',
                promise: ticket.promise,
              })
            : null,
        })),
      );
      try {
        const current = await readLogoutPrivacyGeneration();
        if (!active()) return;
        if (
          stateRef.current.acceptedRevocation !== null &&
          (!bindingMatches ||
            (current.status === 'valid' &&
              current.generation !== stateRef.current.generation))
        )
          revoke();
        if (
          protectedRoute &&
          current.status === 'absent' &&
          stateRef.current.acceptedRevocation !== null &&
          stateRef.current.generation !== 'absent'
        ) {
          needsIdentity = true;
          setState((previous) => ({ ...previous, uncertain: true }));
        }
        let result = await verifyTabPrivacy(
          current,
          active,
          false,
          pauseForCleanup,
        );
        if (!active()) return;
        if (result.ready && needsIdentity) {
          result = {
            ready: false,
            issue:
              'This workspace’s original account access could not be verified. Retry when that account’s access is restored.',
          };
          // A generation comparison can observe another logout after the identity
          // read. Recheck the original owner, bounded under sustained churn.
          for (let check = 0; check < 3 && active(); check++) {
            if (!ownerBinding) break;
            const identity = await readProtectedPrivacyIdentity(ownerBinding);
            if (!active()) return;
            if (identity.status !== 'match') {
              if (identity.status === 'denied') revoke();
              break;
            }
            const checked = await verifyTabPrivacy(
              identity.generation,
              active,
              false,
              pauseForCleanup,
            );
            if (!active()) return;
            if (!checked.ready) {
              result = checked;
              break;
            }
            const checkedGeneration =
              identity.generation.status === 'valid'
                ? identity.generation.generation
                : 'absent';
            if (checked.generation !== checkedGeneration) continue;
            if (bindingMatches) result = checked;
            break;
          }
        }
        if (serverUncertain)
          result = {
            ready: false,
            issue:
              'This workspace’s original account access could not be verified. Retry when that account’s access is restored.',
          };
        // Precommit proof cannot adopt a changed generation or owned cleanup epochs.
        if (
          ticket &&
          result.ready &&
          result.generation !== ticket.capture.generation
        ) {
          revoke();
          return;
        }
        if (!result.ready) titles.clear();
        if (task && taskOperation.current === task) {
          if (
            result.ready &&
            result.generation === task.capture.generation &&
            taskOperationCurrent(task)
          )
            task.setStatus('verified');
          else task.setStatus('retired');
        }
        if (ticket) {
          if (result.ready && ticketCurrent(ticket))
            tickets.markVerified(ticket);
          else tickets.retire();
        }
        // A published failure already exposes Retry and ends checking. Only an
        // interrupted owned cleanup needs the distinct recovery in finally.
        recoverCurrent = false;
        setState(
          (previous) =>
            result.ready
              ? {
                  ...previous,
                  ready: true,
                  checking: false,
                  uncertain: false,
                  navigationTicket: ticket
                    ? Object.freeze({
                        capture: ticket.capture,
                        status: 'verified',
                        promise: ticket.promise,
                      })
                    : null,
                  generation: result.generation,
                  issue: '',
                  key: target,
                  acceptedRevocation: operation.epoch,
                  acceptedServerRevision: serverRevision,
                  acceptedCallbackRevision: operation.callbacks,
                }
              : {
                  ...previous,
                  ready: false,
                  navigationTicket: null,
                  checking: false,
                  uncertain: true,
                  issue: result.issue,
                  key: target,
                },
          attempt,
        );
      } catch {
        if (task && taskOperation.current === task) task.setStatus('retired');
        if (active()) {
          titles.clear();
          setState((previous) => ({
            ...previous,
            ready: false,
            navigationTicket: null,
            checking: false,
            uncertain: true,
            issue: cleanupIssue,
            key: target,
          }));
        }
      } finally {
        if (ticket?.status === 'pending')
          tickets.retire(ticket.capture.provider);
        if (inFlight.current === operation) inFlight.current = null;
        // Owned cleanup invalidations cannot rebase an immutable target ticket.
        // Resume the canonical current-route recovery as a distinct verification.
        if (recoverCurrent && mounted.current && request.current === attempt)
          queueMicrotask(() => {
            if (mounted.current) void retryRef.current();
          });
      }
    },
    [
      key,
      protectedRoute,
      ownerBinding,
      ownerAuthority,
      bindingMatches,
      serverRevision,
      serverUncertain,
      titles,
      tickets,
      ticketCurrent,
      setState,
      taskOperationCurrent,
    ],
  );
  const retryRef = useRef(retry);
  useLayoutEffect(() => {
    retryRef.current = retry;
  }, [retry]);
  const retireTarget = useCallback(
    (provider?: symbol) => {
      const ticket = tickets.snapshot();
      if (
        !ticket ||
        (provider !== undefined && ticket.capture.provider !== provider)
      )
        return;
      const retiredRequest = ++request.current;
      // Publish the negative React state before retirement wakes the old primary.
      // This microtask is safe when provider cleanup runs in an insertion effect.
      queueMicrotask(() => {
        if (!mounted.current || request.current !== retiredRequest) return;
        flushSync(() =>
          setState(
            (previous) => ({
              ...previous,
              navigationTicket: null,
              checking: true,
            }),
            retiredRequest,
          ),
        );
        if (document.visibilityState !== 'hidden') void retryRef.current();
      });
      tickets.retire(provider);
    },
    [tickets, setState],
  );
  useLayoutEffect(() => {
    const view = state.navigationTicket;
    if (!view || view.status !== 'verified') return;
    const live = tickets.snapshot();
    if (
      live &&
      live.capture === view.capture &&
      ticketCurrent(live) &&
      (key.navigation === view.capture.source ||
        key.navigation === view.capture.destination) &&
      bindingRevision === view.capture.binding &&
      serverRevision === view.capture.serverRevision &&
      revision === view.capture.revision &&
      state.generation === view.capture.generation
    )
      tickets.settleVerified(live);
  }, [
    state.navigationTicket,
    state.generation,
    key.navigation,
    bindingRevision,
    serverRevision,
    revision,
    tickets,
    ticketCurrent,
  ]);

  useEffect(() => {
    mounted.current = true;
    const reactivate = () => {
      if (taskOperation.current) taskOperation.current.setStatus('retired');
      if (tickets.snapshot()) {
        tickets.retire();
        request.current++;
        setState((previous) => ({ ...previous, navigationTicket: null }));
      }
      if (document.visibilityState !== 'hidden') void retryRef.current();
    };
    const retire = () => {
      if (taskOperation.current) taskOperation.current.setStatus('retired');
      tickets.retire();
      setState((previous) => ({ ...previous, navigationTicket: null }));
    };
    const unbindRevocation = subscribePrivacyRevocation(retire);
    const unbindCallbacks = subscribeAssignmentInvalidation(retire);
    window.addEventListener('focus', reactivate);
    window.addEventListener('pageshow', reactivate);
    document.addEventListener('visibilitychange', reactivate);
    return () => {
      cancel();
      unbindRevocation();
      unbindCallbacks();
      window.removeEventListener('focus', reactivate);
      window.removeEventListener('pageshow', reactivate);
      document.removeEventListener('visibilitychange', reactivate);
    };
  }, [cancel, tickets, setState]);
  const committedNavigation = useRef(key.navigation);
  useEffect(() => {
    const unchangedNavigation = committedNavigation.current === key.navigation;
    committedNavigation.current = key.navigation;
    // Installing a completed ordinary handoff is not another verification.
    // The subsequent clean-key render owns its distinct parent-linked check.
    if (
      unchangedNavigation &&
      proposedTaskOperation?.status() === 'consumed' &&
      taskOperationCurrent(proposedTaskOperation) &&
      matchingKey(stateRef.current.key, key)
    )
      return;
    const ticket = tickets.snapshot();
    if (
      ticket &&
      ticketCurrent(ticket) &&
      (ticket.capture.destination === key.navigation ||
        // Source admission only spans a continuous precommit stay. Returning
        // after another route committed requires canonical verification again.
        (ticket.capture.source === key.navigation && unchangedNavigation))
    )
      return;
    tickets.retire();
    setState((previous) => ({ ...previous, navigationTicket: null }));
    queueMicrotask(() => {
      if (mounted.current) void retry(key, undefined, proposedTaskOperation);
    });
  }, [
    retry,
    key,
    tickets,
    ticketCurrent,
    setState,
    proposedTaskOperation,
    taskOperationCurrent,
  ]);
  useEffect(() => {
    // Cleanup owns its callback invalidation even when storage remains blocked.
    // Retry only for a new external signal, not our own unsuccessful cleanup.
    const handled = handledInvalidation.current;
    if (
      handled.epoch === revocationRevision &&
      handled.callbacks === callbackRevision
    )
      return;
    handledInvalidation.current = {
      epoch: revocationRevision,
      callbacks: callbackRevision,
    };
    queueMicrotask(() => {
      if (mounted.current) void retry();
    });
  }, [revocationRevision, callbackRevision, retry]);
  const knownServerChange =
    serverGeneration !== undefined &&
    serverGeneration.status === 'valid' &&
    state.acceptedRevocation !== null &&
    serverRevision !== state.acceptedServerRevision;
  if (serverUncertain && !state.uncertain)
    dispatchState({
      sequence: state.sequence,
      update: { ...state, uncertain: true, navigationTicket: null },
    });
  useLayoutEffect(() => {
    if (
      state.acceptedRevocation !== null &&
      (!bindingMatches || knownServerChange) &&
      readPrivacyRevocationRevision() === state.acceptedRevocation
    )
      revokePrivatePresentation();
  }, [bindingMatches, knownServerChange, state.acceptedRevocation]);
  const acceptedVisible =
    !state.uncertain &&
    !serverUncertain &&
    state.acceptedRevocation !== null &&
    state.acceptedRevocation === revocationRevision &&
    bindingMatches &&
    !knownServerChange;
  const ready =
    state.ready &&
    !state.checking &&
    matchingKey(state.key, key) &&
    state.acceptedRevocation === revocationRevision &&
    state.acceptedCallbackRevision === callbackRevision &&
    (!protectedRoute || acceptedVisible);
  const visible = protectedRoute ? acceptedVisible : ready;
  const taskContinuity = useCallback(
    (operation: TaskQueryOperation): PrivacyTaskQueryContinuity => {
      const capture = operation.capture;
      return {
        identity: operation.identity,
        parent: operation.parent,
        kind: operation.kind,
        sourceKey: capture.sourceKey,
        destinationKey: capture.destinationKey,
        securityRevision: capture.securityRevision,
        status: () =>
          operation.status() === 'prepared'
            ? 'pending'
            : (operation.status() as
                'pending' | 'verified' | 'consumed' | 'retired'),
        current: () => taskOperationCurrent(operation),
        consumptionReady: () => {
          const committed = stateRef.current;
          // Status is marked before React publishes successful verification. Only
          // the committed controller state may release an existing task receipt.
          return (
            (operation.status() === 'verified' ||
              operation.status() === 'consumed') &&
            taskOperationCurrent(operation) &&
            committed.ready &&
            !committed.checking &&
            !committed.uncertain &&
            committed.key?.navigation === capture.destinationKey &&
            committed.key.bindingRevision === capture.binding &&
            committed.key.serverRevision === capture.serverRevision &&
            committed.key.revision === capture.revision &&
            committed.acceptedRevocation === capture.revocation &&
            committed.acceptedCallbackRevision === capture.callbacks &&
            committed.acceptedServerRevision === capture.serverRevision
          );
        },
        complete: (cleanKey: string) => {
          if (
            operation.kind !== 'task' ||
            operation.status() !== 'verified' ||
            !taskOperationCurrent(operation) ||
            !stateRef.current.ready ||
            stateRef.current.checking ||
            stateRef.current.uncertain ||
            stateRef.current.key?.navigation !== capture.destinationKey ||
            cleanKey !== capture.cleanKey ||
            routeKey(
              location.pathname,
              new URLSearchParams(location.search),
            ) !== cleanKey
          )
            return false;
          operation.setStatus('consumed');
          return true;
        },
      };
    },
    [taskOperationCurrent],
  );
  const taskQuery = useMemo(
    () =>
      proposedTaskOperation ? taskContinuity(proposedTaskOperation) : undefined,
    [proposedTaskOperation, taskContinuity],
  );
  useLayoutEffect(() => {
    titles.accept(
      protectedRoute &&
        visible &&
        matchingKey(state.key, key) &&
        state.acceptedRevocation !== null &&
        bindingMatches
        ? {
            navigation: key.navigation,
            binding: bindingRevision,
            revocation: state.acceptedRevocation,
            callbacks: state.acceptedCallbackRevision,
          }
        : null,
    );
  }, [
    titles,
    protectedRoute,
    visible,
    state.key,
    key,
    bindingMatches,
    bindingRevision,
    state.acceptedRevocation,
    state.acceptedCallbackRevision,
  ]);
  const privacy = useMemo(
    () => ({
      ready,
      visible,
      generation: state.generation,
      cleanupRevision,
      revocationRevision,
      verifiedEpoch:
        ready && protectedRoute ? state.acceptedCallbackRevision : undefined,
      taskQuery,
      navigation: protectedRoute
        ? {
            bind: (provider: symbol) => {
              if (navigationProvider.current !== provider) retireTarget();
              navigationProvider.current = provider;
              return () => {
                if (navigationProvider.current !== provider) return;
                navigationProvider.current = null;
                retireTarget(provider);
              };
            },
            prepare: (href: string, provider: symbol) => {
              if (!mounted.current || navigationProvider.current !== provider)
                return;
              retireTarget(provider);
              const previous = stateRef.current;
              if (
                !mounted.current ||
                navigationProvider.current !== provider ||
                !bindingMatches ||
                !visible ||
                !previous.ready ||
                previous.checking ||
                previous.acceptedRevocation !==
                  readPrivacyRevocationRevision() ||
                previous.acceptedCallbackRevision !== assignmentEpoch() ||
                document.visibilityState === 'hidden'
              )
                return;
              const url = new URL(href, location.origin);
              if (url.origin !== location.origin) return;
              const destination = routeKey(url.pathname, url.searchParams);
              if (destination === key.navigation) return;
              const target = { ...key, navigation: destination };
              const ticket = tickets.begin({
                provider,
                destination,
                source: key.navigation,
                binding: bindingRevision,
                generation: previous.generation,
                serverRevision,
                revision,
                revocation: previous.acceptedRevocation!,
                callbacks: previous.acceptedCallbackRevision,
                request: ++request.current,
              });
              void retry(target, ticket);
            },
            retire: retireTarget,
            captureTaskConsumption: (sourceKey: string) => {
              const accepted = stateRef.current;
              const configured = { ...configuration.current };
              const sequence = request.current;
              const epoch = readPrivacyRevocationRevision();
              const callbacks = assignmentEpoch();
              const cleanup = readAuthoritativeCleanupRevision();
              const current = () =>
                mounted.current &&
                document.visibilityState !== 'hidden' &&
                stateRef.current === accepted &&
                accepted.ready &&
                !accepted.checking &&
                !accepted.uncertain &&
                accepted.key?.navigation === sourceKey &&
                configuration.current.navigation === sourceKey &&
                configuration.current.bindingMatches &&
                configuration.current.bindingRevision ===
                  configured.bindingRevision &&
                configuration.current.serverRevision ===
                  configured.serverRevision &&
                configuration.current.revision === configured.revision &&
                accepted.key.bindingRevision === configured.bindingRevision &&
                accepted.key.serverRevision === configured.serverRevision &&
                accepted.key.revision === configured.revision &&
                accepted.acceptedRevocation === epoch &&
                accepted.acceptedCallbackRevision === callbacks &&
                accepted.sequence === sequence &&
                request.current === sequence &&
                readPrivacyRevocationRevision() === epoch &&
                assignmentEpoch() === callbacks &&
                readAuthoritativeCleanupRevision() === cleanup;
              if (!current()) return null;
              let used = false;
              return (cleanKey: string) => {
                if (used) return null;
                used = true;
                if (
                  !current() ||
                  taskQueryDestination(cleanKey, sourceKey) !== cleanKey ||
                  routeKey(
                    location.pathname,
                    new URLSearchParams(location.search),
                  ) !== cleanKey
                )
                  return null;
                const operation = taskQueryOperation(
                  Object.freeze({
                    sourceKey,
                    destinationKey: sourceKey,
                    cleanKey,
                    binding: configured.bindingRevision,
                    serverRevision: configured.serverRevision,
                    revision: configured.revision,
                    generation: accepted.generation,
                    revocation: epoch,
                    callbacks,
                    cleanup,
                    request: sequence,
                    securityRevision: JSON.stringify([
                      accepted.generation,
                      cleanup,
                      epoch,
                      callbacks,
                      callbacks,
                      cleanup,
                    ]),
                  }),
                  null,
                  'task',
                );
                operation.setStatus('consumed');
                taskOperation.current?.setStatus('retired');
                taskOperation.current = operation;
                setTaskSlot({ key: accepted.key!, operation });
                return controllerTaskContinuity(taskContinuity(operation));
              };
            },
            admission: (destination: string) => {
              const ticket = state.navigationTicket;
              if (
                ticket &&
                ticket.capture.destination === destination &&
                visible &&
                document.visibilityState !== 'hidden' &&
                ticket.capture.revocation === readPrivacyRevocationRevision() &&
                ticket.capture.callbacks === assignmentEpoch() &&
                (key.navigation === ticket.capture.source ||
                  key.navigation === ticket.capture.destination) &&
                ticket.capture.binding === bindingRevision &&
                ticket.capture.serverRevision === serverRevision &&
                ticket.capture.revision === revision &&
                ticket.capture.generation === state.generation
              ) {
                if (ticket.status === 'pending')
                  return { ready: false, wait: ticket.promise };
                return {
                  ready: ticket.status === 'verified' && !state.uncertain,
                  verifiedEpoch: ticket.capture.callbacks,
                };
              }
              return { ready: ready && key.navigation === destination };
            },
          }
        : undefined,
    }),
    [
      ready,
      visible,
      state.generation,
      cleanupRevision,
      revocationRevision,
      protectedRoute,
      state.acceptedCallbackRevision,
      tickets,
      bindingMatches,
      key,
      bindingRevision,
      serverRevision,
      revision,
      retry,
      retireTarget,
      state.uncertain,
      state.navigationTicket,
      taskQuery,
      taskContinuity,
    ],
  );
  // Protected cleanup is fixed below: removing status must not displace an
  // admitted private page. Auth-entry cleanup retains its existing placement.
  const cleanup = !visible && (
    <CleanupStatus
      issue={state.issue}
      retry={() => void retry()}
      retainedOwner={protectedRoute && state.acceptedRevocation !== null}
    />
  );
  return (
    <PrivateDocumentTitleContext value={titles}>
      <PrivacyReadinessContext value={privacy}>
        {protectedRoute && cleanup && (
          <div
            role="region"
            aria-label="Privacy cleanup"
            style={{ position: 'fixed' }}
            className="right-4 bottom-4 left-4 z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-[color:var(--warning)] bg-[var(--surface)] p-4 text-[color:var(--foreground)] shadow-lg sm:left-auto sm:w-sm"
          >
            {cleanup}
          </div>
        )}
        {protectedRoute ? (
          (children as ReactNode)
        ) : (
          <AcceptedPrivacyContent ready={ready} generation={state.generation}>
            {children}
          </AcceptedPrivacyContent>
        )}
        {!protectedRoute && cleanup}
      </PrivacyReadinessContext>
    </PrivateDocumentTitleContext>
  );
}

export function AuthPrivacyRedirect({ destination }: { destination: string }) {
  return (
    <AuthPrivacyBoundary>
      <VerifiedPrivacyNavigation destination={destination} />
    </AuthPrivacyBoundary>
  );
}
function VerifiedPrivacyNavigation({ destination }: { destination: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(destination);
    router.refresh();
  }, [router, destination]);
  return <p role="status">Opening your workspace…</p>;
}

/** A confirmed password/logout result retries cleanup only, never the mutation. */
export function PasswordLogoutCompletion({
  receipt,
  destination = '/login?password=updated',
}: {
  receipt: LogoutPrivacyReceipt;
  destination?: string;
}) {
  const router = useRouter();
  const [issue, setIssue] = useState('');
  const revoked = useRef(false);
  const request = useRef(0);
  const mounted = useRef(false);
  const cancel = useCallback(() => {
    mounted.current = false;
    request.current++;
  }, []);
  const retry = useCallback(async () => {
    const attempt = ++request.current;
    const active = () => mounted.current && request.current === attempt;
    if (!revoked.current) {
      revoked.current = true;
      revokePrivatePresentation();
    }
    if (receipt.cleanupReminderUnavailable) {
      setIssue(reminderIssue);
      return;
    }
    setIssue('');
    const result = await verifyTabPrivacy(
      { status: 'valid', generation: receipt.logoutGeneration },
      active,
      true,
    );
    if (!active()) return;
    if (!result.ready) {
      setIssue(result.issue);
      return;
    }
    router.replace(destination);
    router.refresh();
  }, [receipt, router, destination]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (mounted.current) void retry();
    });
    return cancel;
  }, [retry, cancel]);
  return (
    <CleanupStatus
      issue={issue}
      retry={() => void retry()}
      retryLabel="Finish signing out"
    />
  );
}
