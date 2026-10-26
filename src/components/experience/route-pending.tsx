'use client';

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { useEffectiveReducedMotion } from './motion-preference';
import { createRoutePendingState } from './route-pending-state';
import {
  createRoutePendingOwners,
  bindPendingRunner,
  bindPendingFinish,
  mountStandalonePendingOwner,
  type PendingOwner,
} from './route-pending-owners';
import { observeRouteActionResult } from './route-action-result';
import { RoutePresentationSourceContext } from './route-presentation-source';
import {
  LoadingSkeleton,
  type LoadingShape,
} from '@/components/ui/loading-skeleton';

export type RoutePendingState = ReturnType<typeof createRoutePendingState>;
export type RouteTransitionAction = (action: () => void) => void;
type Run = RouteTransitionAction;
type Scope = {
  state: RoutePendingState;
  owners: ReturnType<typeof createRoutePendingOwners>;
  terminal: () => void;
  navigation?: (href: string) => void;
  /** Read-only notification at the existing accepted-navigation point. */
  observeNavigation?: (observer: (href: string) => void) => () => void;
  beginNavigation?: (
    href: string,
  ) => { close: () => void; current: () => boolean } | undefined;
};
export const RoutePendingContext = createContext<Scope | null>(null);
const emptySubscribe = () => () => {};
const idle = { epoch: 0, pending: false, delayed: false, announcement: null };
const idleSnapshot = () => idle;

/** Register only genuine mounted pending UI; URL changes do not imply readiness. */
export function useReportRoutePending(
  pending: boolean,
  retainAcrossBack = false,
  announcement?: symbol,
) {
  const scope = useContext(RoutePendingContext);
  const snapshot = useSyncExternalStore(
    scope?.state.subscribe ?? emptySubscribe,
    scope?.state.snapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const epoch = retainAcrossBack ? snapshot.epoch : undefined;
  useLayoutEffect(() => {
    if (pending) return scope?.state.register(epoch, announcement);
  }, [scope, pending, epoch, announcement]);
  return !scope || snapshot.announcement === announcement || !snapshot.pending;
}

/** A retired runner is replaced without remounting the page or any drafts. */
export function RouteTransitionRunner({
  scope,
  epoch,
  owner,
}: {
  scope: Scope;
  epoch: number;
  owner: PendingOwner;
}) {
  const [pending, begin] = useTransition();
  useLayoutEffect(() => {
    const run: Run = (action) => {
      if (!owner.live || !scope.state.current(epoch)) return;
      // Never return an async task to React's shared action scope.
      begin(() => {
        action();
      });
    };
    return bindPendingRunner(owner, run);
  }, [scope, epoch, owner]);
  useLayoutEffect(() => {
    if (!pending || !owner.live) return;
    const finish = scope.state.register(epoch);
    return bindPendingFinish(owner, finish);
  }, [scope, epoch, pending, owner]);
  return null;
}

function usePendingOwner() {
  const scope = useContext(RoutePendingContext);
  const id = useId();
  const [owner] = useState<PendingOwner>(() => ({
    id,
    live: false,
    incarnation: 0,
    run: null,
    finish: null,
  }));
  useLayoutEffect(() => {
    if (scope) return scope.owners.mount(owner);
    return mountStandalonePendingOwner(owner);
  }, [scope, owner]);
  return { scope, owner };
}

export function RouteProgress() {
  const scope = useContext(RoutePendingContext);
  const snapshot = useSyncExternalStore(
    scope?.state.subscribe ?? emptySubscribe,
    scope?.state.snapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const reduced = useEffectiveReducedMotion();
  const visible = snapshot.pending && (reduced || snapshot.delayed);
  return (
    <div
      className="experience-route-progress"
      data-visible={visible}
      data-static={reduced}
      aria-hidden={!visible}
    >
      <span
        role={visible && !snapshot.announcement ? 'status' : undefined}
        className="sr-only"
      >
        {snapshot.announcement ? '' : 'Working…'}
      </span>
      <span className="experience-route-progress-bar" aria-hidden="true" />
    </div>
  );
}

/** Preserve local pending controls and React's action/error semantics. */
export function useRouteTransition(): [boolean, RouteTransitionAction] {
  const { scope, owner } = usePendingOwner();
  const epoch = useSyncExternalStore(
    scope?.state.subscribe ?? emptySubscribe,
    scope?.state.snapshot ?? idleSnapshot,
    idleSnapshot,
  ).epoch;
  const [pending, begin] = useTransition();
  const run = useCallback<RouteTransitionAction>(
    (action) =>
      begin(() => {
        if (!scope || !owner.live || !scope.state.current(epoch)) {
          action();
          return;
        }
        // Early hydration can invoke before the bridge's layout setup. Preserve
        // the action in that progressive case; never swallow an operation.
        if (owner.run) owner.run(action);
        else action();
      }),
    [scope, begin, epoch, owner],
  );
  return [pending, run];
}

type Task = { finish: () => void; settled: boolean; current: () => boolean };
function useOwnedTasks() {
  const { scope, owner } = usePendingOwner();
  const tasks = useRef(new Map<symbol, Task>());
  const [snapshot, commitSnapshot] = useReducer(
    (previous: { pending: boolean; revision: number }, pending: boolean) => ({
      pending,
      revision: previous.revision + 1,
    }),
    { pending: false, revision: 0 },
  );
  const publish = useCallback(() => {
    // Read the actual invocation map only in events/committed effects. The
    // revision also commits settlement when another invocation remains busy.
    commitSnapshot(
      Array.from(tasks.current.values()).some(
        (task) => !task.settled && task.current(),
      ),
    );
  }, []);
  useLayoutEffect(() => {
    // Release only after the caller's completion/error state actually commits.
    for (const [token, task] of tasks.current) {
      if (task.settled || !task.current()) {
        task.finish();
        tasks.current.delete(token);
      }
    }
  });
  useLayoutEffect(() => {
    publish();
    const owned = tasks.current;
    return () => {
      owned.forEach((task) => task.finish());
      owned.clear();
    };
  }, [owner, scope, publish]);
  const capture = useCallback(() => {
    const incarnation = owner.incarnation;
    // Local business busy survives history/presentation cancellation. Only
    // actual owner retirement can withdraw an unresolved invocation locally.
    return () => owner.live && owner.incarnation === incarnation;
  }, [owner]);
  const track = useCallback(
    <T,>(action: PromiseLike<T>, signal?: AbortSignal) => {
      const owned = capture();
      const current = () => owned() && !signal?.aborted;
      const epoch = scope?.state.snapshot().epoch;
      const presentationCurrent = () =>
        current() && (!scope || scope.state.current(epoch!));
      if (current()) {
        const token = Symbol();
        const release = scope?.state.register(epoch) ?? (() => {});
        const abort = () => {
          task.finish();
          tasks.current.delete(token);
          if (owned()) publish();
        };
        const task: Task = {
          finish: () => {
            signal?.removeEventListener('abort', abort);
            release();
          },
          settled: false,
          current,
        };
        tasks.current.set(token, task);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        publish();
        const settle = () => {
          if (!current() || tasks.current.get(token) !== task) return;
          task.settled = true;
          publish();
        };
        // Observe settlement without changing the original result/rejection.
        void Promise.resolve(action).then(settle, settle);
      }
      // Access-denial/private presentation callbacks still require their original
      // provider epoch, even when the same owner's local busy remains valid.
      return presentationCurrent;
    },
    [scope, capture, publish],
  );
  return { pending: snapshot.pending, track, capture };
}

/** Fire-and-forget event tasks forward unexpected rejection to the React boundary. */
export function useRouteTask(): [
  boolean,
  (action: () => void | Promise<void>, signal?: AbortSignal) => void,
] {
  const { pending, track, capture } = useOwnedTasks();
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const run = useCallback(
    (action: () => void | Promise<void>, signal?: AbortSignal) => {
      const current = capture();
      let promise: Promise<void>;
      try {
        promise = Promise.resolve(action());
      } catch (error) {
        promise = Promise.reject(error);
      }
      try {
        track(promise, signal);
      } catch {
        /* Presentation cannot replace the original task outcome. */
      }
      void promise.catch((error: unknown) => {
        if (current() && !signal?.aborted) setFailure({ error });
      });
    },
    [track, capture],
  );
  if (failure) throw failure.error;
  return [pending, run];
}

/** All methods keep the supported Next router contract, including void returns. */
export function useRouteRouter() {
  const router = useRouter();
  const scope = useContext(RoutePendingContext);
  const [, begin] = useRouteTransition();
  return useMemo(() => {
    const run = (action: () => void) => {
      let threw = false;
      let failure: unknown;
      // React invokes the synchronous action immediately, but consumes a throw
      // itself. Preserve the router's existing synchronous caller contract.
      begin(() => {
        try {
          action();
        } catch (error) {
          threw = true;
          failure = error;
        }
      });
      if (threw) throw failure;
    };
    return {
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        run(() => {
          scope?.navigation?.(args[0]);
          router.push(...args);
        }),
      replace: (...args: Parameters<typeof router.replace>) =>
        run(() => {
          scope?.navigation?.(args[0]);
          router.replace(...args);
        }),
      refresh: () => run(() => router.refresh()),
    };
  }, [router, begin, scope]);
}

/** Observe an already-started promise; request, result and rejection are unchanged. */
export function useRouteActionResult() {
  const { track, capture } = useOwnedTasks();
  const source = useContext(RoutePresentationSourceContext);
  return useCallback(
    <T,>(action: PromiseLike<T>) => {
      let current = () => false;
      try {
        current = capture();
        track(action);
      } catch {
        /* Preserve the original result/rejection. */
      }
      return observeRouteActionResult(action, current, source);
    },
    [track, capture, source],
  );
}

/** Suitable as a real Suspense/loading fallback, with no old page or private cache. */
export function RouteLoading({
  shape = 'rows',
  label = 'Opening requested content…',
  rows,
}: {
  shape?: LoadingShape;
  label?: string;
  rows?: number;
} = {}) {
  const [owner] = useState(() => Symbol());
  const announce = useReportRoutePending(true, true, owner);
  return (
    <LoadingSkeleton
      shape={shape}
      label={label}
      rows={rows}
      announce={announce}
    />
  );
}

export function RoutePendingTerminal() {
  const scope = useContext(RoutePendingContext);
  const handled = useRef(false);
  useLayoutEffect(() => {
    if (!handled.current) {
      handled.current = true;
      scope?.terminal();
    }
  }, [scope]);
  return null;
}
