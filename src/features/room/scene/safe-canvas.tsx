'use client';
import {
  createRoot,
  events,
  extend,
  unmountComponentAtNode,
} from '@react-three/fiber';
import {
  Color,
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  AmbientLight,
  DirectionalLight,
  LineSegments,
  LineBasicMaterial,
} from 'three';
// Public createRoot is deliberately catalogue-free; match Canvas's constructor registration.
extend({
  Color,
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  AmbientLight,
  DirectionalLight,
  LineSegments,
  LineBasicMaterial,
});
import {
  Component,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  PrivacyReadinessContext,
  usePrivacyReadiness,
} from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  subscribeAssignmentInvalidation,
  subscribePrivacyRevocation,
  subscribeAuthoritativeCleanup,
} from '@/features/scan/assign-batch';
import { useRoomSceneAuthority } from './camera-snapshot-provider';
import { cameraAuthorityKey } from './camera-snapshot-store';
import {
  ScenePriorityContext,
  SceneSessionContext,
  useSceneBudget,
} from './scene-budget-provider';
import type { SceneLease } from './scene-budget';
import { teardownFailedCanvas } from './failed-canvas-teardown';

type Configuration = NonNullable<
  Parameters<ReturnType<typeof createRoot>['configure']>[0]
>;
type Props = Configuration & {
  onLeaseChange?: (active: boolean) => void;
  children: ReactNode;
  fallback?: ReactNode;
  onFailure(message: string): void;
};
export class GraphicsBoundary extends Component<
  { children: ReactNode; onFailure(message: string): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure(
      'The room scene could not render. Use the location list or retry.',
    );
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
/**
 * Canvas's bundled async configure is not awaited by a React error boundary.
 * This host catches that actual renderer-initialization promise locally.
 */
export function SafeCanvas({
  children,
  fallback,
  onFailure,
  onLeaseChange,
  ...configuration
}: Props) {
  const budget = useSceneBudget();
  const priority = useContext(ScenePriorityContext);
  const privacy = usePrivacyReadiness();
  const authority = useRoomSceneAuthority();
  const key = authority
    ? cameraAuthorityKey(authority)
    : privacy.generation === 'unmanaged'
      ? 'unmanaged'
      : null;
  const [owner] = useState(() => {
    let retired = false;
    return {
      key,
      generation: privacy.generation,
      revision: readPrivacyRevocationRevision(),
      epoch: assignmentEpoch(),
      retired: () => retired,
      retire: () => {
        retired = true;
      },
    };
  });
  const latest = useRef({ privacy, key, onLeaseChange });
  useLayoutEffect(() => {
    latest.current = { privacy, key, onLeaseChange };
  }, [privacy, key, onLeaseChange]);
  const host = useRef<HTMLDivElement>(null);
  const [lease, setLease] = useState<SceneLease | null>(null);
  const [requestStatus, setRequestStatus] = useState<
    'starting' | 'queued' | 'withdrawn' | 'failed'
  >('starting');
  const [retry, setRetry] = useState(0);
  const leaseRef = useRef<SceneLease | null>(null);
  useLayoutEffect(() => {
    // A committed identity/environment change retires the original session even
    // if an outer controller has not emitted its invalidation event yet.
    if (
      !owner.retired() &&
      (owner.key !== key || owner.generation !== privacy.generation)
    ) {
      owner.retire();
      if (host.current) {
        host.current.hidden = true;
        host.current.inert = true;
        host.current.setAttribute('inert', '');
      }
      leaseRef.current?.cancel();
    }
  }, [key, privacy.generation, owner]);
  const permittedFor = (candidate: {
    privacy: typeof privacy;
    key: string | null;
  }) =>
    !owner.retired() &&
    owner.key !== null &&
    owner.key === candidate.key &&
    owner.generation === candidate.privacy.generation &&
    owner.revision === readPrivacyRevocationRevision() &&
    owner.epoch === assignmentEpoch() &&
    (candidate.privacy.generation === 'unmanaged'
      ? candidate.privacy.ready
      : freshPresentationGrant(candidate.privacy));
  const current = useCallback(() => {
    const { privacy, key } = latest.current;
    return (
      !owner.retired() &&
      owner.key !== null &&
      owner.key === key &&
      owner.generation === privacy.generation &&
      owner.revision === readPrivacyRevocationRevision() &&
      owner.epoch === assignmentEpoch() &&
      (privacy.generation === 'unmanaged'
        ? privacy.ready
        : freshPresentationGrant(privacy))
    );
  }, [owner]);
  useInsertionEffect(() => {
    const retire = () => {
      owner.retire();
      if (host.current) {
        host.current.hidden = true;
        host.current.inert = true;
        host.current.setAttribute('inert', '');
      }
      leaseRef.current?.cancel();
    };
    const remove = [
      subscribePrivacyRevocation(retire),
      subscribeAssignmentInvalidation(retire),
      subscribeAuthoritativeCleanup(retire),
    ];
    return () => {
      owner.retire();
      remove.forEach((unsubscribe) => unsubscribe());
    };
  }, [owner]);
  useEffect(() => {
    if (!current()) return;
    let live = true;
    let granted = false;
    const request = budget.request(
      priority,
      () => {
        granted = true;
        if (leaseRef.current && live && current()) {
          setLease(leaseRef.current);
          latest.current.onLeaseChange?.(true);
        }
      },
      () => {
        if (live) {
          setLease(null);
          setRequestStatus('withdrawn');
          latest.current.onLeaseChange?.(false);
        }
      },
    );
    leaseRef.current = request;
    if (!granted && current()) setRequestStatus('queued');
    if (granted && current()) {
      setLease(request);
      latest.current.onLeaseChange?.(true);
    }
    return () => {
      live = false;
      request.cancel();
      latest.current.onLeaseChange?.(false);
      leaseRef.current = null;
    };
    // A session never adopts a new identity; ordinary verification resumes the original session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, priority, privacy.ready, key, owner, retry]);
  const permitted = permittedFor({ privacy, key });
  return (
    <div
      ref={host}
      hidden={!permitted}
      inert={!permitted}
      style={{ height: '100%', width: '100%' }}
    >
      {lease && permitted ? (
        <CanvasRoot
          {...configuration}
          onFailure={(message) => {
            if (current()) {
              setLease(null);
              setRequestStatus('failed');
              latest.current.onLeaseChange?.(false);
              onFailure(message);
            }
          }}
          fallback={fallback}
          lease={lease}
          current={current}
        >
          <PrivacyReadinessContext value={privacy}>
            {children}
          </PrivacyReadinessContext>
        </CanvasRoot>
      ) : (
        <div
          className="p-4 text-sm"
          aria-busy={requestStatus === 'starting' || requestStatus === 'queued'}
        >
          <p role="status">
            {requestStatus === 'starting'
              ? 'Loading map… The location browser remains available.'
              : requestStatus === 'failed'
                ? 'The map could not initialize. The location browser remains available.'
                : 'The map is paused while another map is in use. The location browser remains available.'}
          </p>
          {requestStatus !== 'starting' && (
            <button
              type="button"
              className="min-h-11 text-cyan-300 underline"
              onClick={() => {
                if (current()) {
                  setRequestStatus('starting');
                  setRetry((value) => value + 1);
                }
              }}
            >
              Resume map
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CanvasRoot({
  children,
  fallback,
  onFailure,
  lease,
  current,
  ...configuration
}: Props & { lease: SceneLease; current(): boolean }) {
  const session = useMemo(
    () => ({ current: () => current() && lease.current() }),
    [current, lease],
  );
  const sessionCurrent = session.current;
  // Scene errors belong to the original allocation, even when the same privacy
  // owner later resumes with another lease. Initialization captures authority
  // separately before completing its failed allocation.
  const reportSceneFailure = useCallback(
    (message: string) => {
      if (sessionCurrent()) onFailure(message);
    },
    [sessionCurrent, onFailure],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const root = useRef<ReturnType<typeof createRoot> | null>(null);
  const ready = useRef(false);
  const latest = useRef({ children, configuration });
  useEffect(() => {
    latest.current = { children, configuration };
    if (ready.current && sessionCurrent())
      root.current?.render(
        <SceneSessionContext value={session}>
          <GraphicsBoundary onFailure={reportSceneFailure}>
            {children}
          </GraphicsBoundary>
        </SceneSessionContext>,
      );
  }, [children, configuration, reportSceneFailure, session, sessionCurrent]);
  useEffect(() => {
    const element = canvas.current,
      host = container.current;
    if (!element || !host) return;
    let disposed = false;
    let tearingDown = false;
    let allocationCreated = false;
    let released = false;
    const completeAllocation = () => {
      if (released) return;
      released = true;
      lease.complete();
    };
    // This allocation owns disposal independently of its configuration promise.
    const teardownAllocation = (configureRejected = false) => {
      if (tearingDown || !root.current) return;
      const allocatedRoot = root.current;
      tearingDown = true;
      root.current = null;
      if (configureRejected)
        teardownFailedCanvas(allocatedRoot, element, completeAllocation);
      else unmountComponentAtNode(element, completeAllocation);
    };
    let lastWidth = 0,
      lastHeight = 0;
    let queue = Promise.resolve();
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (
        disposed ||
        width <= 0 ||
        height <= 0 ||
        (width === lastWidth && height === lastHeight)
      )
        return;
      lastWidth = width;
      lastHeight = height;
      queue = queue.then(async () => {
        if (disposed || tearingDown) return;
        let configureRejected = false;
        try {
          if (!sessionCurrent()) return;
          if (!root.current) {
            if (!lease.allocate()) return;
            root.current = createRoot(element);
            allocationCreated = true;
          }
          await root.current
            .configure({
              ...latest.current.configuration,
              events,
              size: { width, height, top: 0, left: 0 },
              onCreated: (state) => {
                // Drei Html portals into events.connected, so connect the host, never the canvas fallback subtree.
                if (!disposed && !tearingDown && sessionCurrent())
                  state.events.connect?.(host);
              },
            })
            .catch((error: unknown) => {
              configureRejected = true;
              throw error;
            });
          if (disposed || tearingDown || !sessionCurrent()) return;
          ready.current = true;
          root.current.render(
            <SceneSessionContext value={session}>
              <GraphicsBoundary onFailure={reportSceneFailure}>
                {latest.current.children}
              </GraphicsBoundary>
            </SceneSessionContext>,
          );
        } catch {
          const report = !disposed && sessionCurrent();
          disposed = true;
          ready.current = false;
          teardownAllocation(configureRejected);
          if (!allocationCreated) {
            // Only root-less construction failure can complete without Fiber.
            // A late configure rejection must never release a disposing root.
            completeAllocation();
          }
          if (report)
            onFailure(
              'The room renderer could not initialize. Use the location list or retry.',
            );
        }
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // Deferral keeps StrictMode's provisional mount from allocating a graphics root.
    const frame = requestAnimationFrame(resize);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      ready.current = false;
      // Public Fiber unmount waits for pending configuration and disposal itself.
      // Waiting for our configure queue first can indefinitely withhold teardown.
      teardownAllocation();
    };
    // This allocation owns one original lease; callback changes cannot recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lease]);
  return (
    <div
      ref={container}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvas}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'auto',
        }}
      >
        {fallback}
      </canvas>
    </div>
  );
}
