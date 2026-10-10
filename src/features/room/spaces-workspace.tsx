'use client';
import dynamic from 'next/dynamic';
import Link from '@/components/experience/route-link';
import { RouteReady } from '@/components/experience/route-ready';
import { routeKey } from '@/components/experience/route-key';
import { useRouteTask } from '@/components/experience/route-pending';
import { CanvasFreeRouteContent } from '@/components/experience/page-arrival';
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  LocationRef,
  InventoryResult,
  PageResult,
} from '../inventory/contracts-ui';
import {
  InventoryRows,
  InventoryCount,
  LocationCode,
} from '../inventory/components/read-ui';
import { countLabel } from '@/lib/count';
import { inventoryDescendantCodes } from '../locations/hierarchy';
import { buildRoomBindings } from './bindings';
import { LocationBrowser } from './location-browser';
import { parseRoomLocation } from './navigation';
import { useRoomOccupancy } from './use-room-occupancy';
import { cameraViewKey, type CameraView } from './scene/camera-view';
import {
  parseRoomContentsResponse,
  roomContentsFilter,
} from './contents-contract';
import type { Space } from './spaces';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import { AmbientLight } from '@/components/experience/ambient-light';
import styles from './room-visual.module.css';
import {
  availableSpaces,
  containingSpace,
  resolveSpace,
  spaces,
  spaceLocations,
  spaceRoom,
} from './spaces';

const RoomScene = dynamic(() => import('./scene/room-scene'), {
  ssr: false,
  loading: () => <p className="p-6">Loading room…</p>,
});
type Selection = { space: Space; code: string | null; page: number };
function parsedPage(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}
function selectionFromUrl(
  locations: LocationRef[],
  fallback: Selection,
): Selection {
  const url = new URL(window.location.href);
  const code = parseRoomLocation(url.searchParams.get('location') ?? undefined);
  const space =
    resolveSpace(locations, url.searchParams.get('space'), code) ??
    fallback.space;
  return {
    space,
    code: spaceLocations(locations, space).some(
      (location) => location.code === code,
    )
      ? code
      : null,
    page: parsedPage(url.searchParams.get('page')),
  };
}
function contentsKey(userId: string, selection: Selection) {
  return [
    userId,
    window.location.origin,
    selection.space.id,
    selection.code ?? '',
    selection.page,
    roomContentsFilter,
  ].join('|');
}
class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <p className="p-6">Room renderer failed. Use the location browser.</p>
    ) : (
      this.props.children
    );
  }
}
export function SpacesWorkspace({
  locations,
  userId,
  initialSpace,
  initialCode,
  initialNotice = null,
  initialPage = 1,
  initialRouteKey = '/room',
}: {
  locations: LocationRef[];
  userId: string;
  initialSpace: Space;
  initialCode: string | null;
  initialNotice?: string | null;
  initialPage?: number;
  initialRouteKey?: string;
}) {
  const [, startContentsRequest] = useRouteTask();
  const [acceptedRouteKey, setAcceptedRouteKey] = useState(initialRouteKey);
  const [selection, setSelection] = useState<Selection>({
    space: initialSpace,
    code: initialCode,
    page: initialPage,
  });
  const reducedMotion = useEffectiveReducedMotion();
  const [contents, setContents] = useState<{
    key: string;
    result?: PageResult<InventoryResult>;
    error?: string;
  } | null>(null);
  const [visible, setVisible] = useState(true);
  const [showCounts, setShowCounts] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [focusTick, setFocusTick] = useState(0);
  const [focusEpoch, setFocusEpoch] = useState(0);
  const [focusOnRestore, setFocusOnRestore] = useState(Boolean(initialCode));
  const cancelFocus = useCallback(() => setFocusOnRestore(false), []);
  const selectionRef = useRef(selection);
  const [focusCompletion, setFocusCompletion] = useState<{
    scope: string;
    request: string;
    code: string | null;
    count: number;
  }>({ scope: '', request: '', code: null, count: 0 });
  const activeFocusIdentity = useRef('');
  const [retryTick, setRetryTick] = useState(0);
  const [cameraViews, setCameraViews] = useState<Map<string, CameraView>>(
    () => new Map(),
  );
  const generation = useRef(0);
  const requestKey =
    typeof window === 'undefined' ? '' : contentsKey(userId, selection);
  const attemptKey = requestKey + ':' + retryTick;
  const result = contents?.key === attemptKey ? contents.result : undefined;
  const error = contents?.key === attemptKey ? contents.error : undefined;
  const loading = Boolean(selection.code && contents?.key !== attemptKey);
  const room = useMemo(() => {
    const registered = spaces.find((space) => space.id === selection.space.id);
    return registered ? spaceRoom(registered) : null;
  }, [selection.space.id]);
  const viewKey = useMemo(
    () =>
      room && typeof window !== 'undefined'
        ? cameraViewKey(
            userId,
            window.location.origin,
            selection.space.id,
            room,
          )
        : null,
    [userId, selection.space.id, room],
  );
  const occupancy = useRoomOccupancy(
    showCounts && visible && Boolean(room),
    userId,
    selection.space.id,
    attemptKey,
  );
  // Mutations live on other routes. Refresh on return (including retained pages)
  // and tab focus; never persist private counts or imply realtime updates.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden')
        setRetryTick((tick) => tick + 1);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const initialView = viewKey ? (cameraViews.get(viewKey) ?? null) : null;
  const bindings = useMemo(() => (room ? buildRoomBindings(room) : []), [room]);
  const scoped = useMemo(
    () => spaceLocations(locations, selection.space),
    [locations, selection.space],
  );
  const currentSpace =
    availableSpaces(locations).find(
      (space) => space.id === selection.space.id,
    ) ?? selection.space;
  const selected = scoped.find((location) => location.code === selection.code);
  const bound =
    !!selected && bindings.some((binding) => binding.code === selected.code);
  const highlightedCodes = useMemo(
    () => inventoryDescendantCodes(scoped, selection.code),
    [scoped, selection.code],
  );
  const focusRequest = useMemo(
    () => ({
      code: bound ? selection.code : null,
      requestId: focusEpoch + focusTick,
    }),
    [bound, selection.code, focusEpoch, focusTick],
  );
  const focusScope = [
    userId,
    typeof window === 'undefined' ? '' : window.location.origin,
    selection.space.id,
  ].join('|');
  const focusIdentity = [
    focusScope,
    selection.code ?? '',
    focusEpoch,
    focusTick,
  ].join('|');
  useLayoutEffect(() => {
    activeFocusIdentity.current = focusIdentity;
    selectionRef.current = selection;
  }, [focusIdentity, selection]);
  const shownFocusCompletion =
    focusCompletion.scope === focusScope
      ? {
          code:
            focusCompletion.request === focusIdentity
              ? focusCompletion.code
              : null,
          count: focusCompletion.count,
        }
      : { code: null, count: 0 };
  useEffect(() => {
    function pop() {
      const next = selectionFromUrl(locations, {
        space: initialSpace,
        code: initialCode,
        page: initialPage,
      });
      if (
        next.space.id !== selectionRef.current.space.id ||
        next.code !== selectionRef.current.code
      ) {
        setFocusCompletion({ scope: '', request: '', code: null, count: 0 });
        setFocusOnRestore(Boolean(next.code));
        setFocusEpoch((epoch) => epoch + 1);
      }
      setSelection(next);
      setAcceptedRouteKey(
        routeKey(
          window.location.pathname,
          new URLSearchParams(window.location.search),
        ),
      );
    }
    window.addEventListener('popstate', pop);
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(
        'inventory-space:' + userId + ':' + window.location.origin,
      );
    } catch {
      /* Storage may be unavailable; the registry default still works. */
    }
    if (!window.location.search && saved) {
      const space = resolveSpace(locations, saved, null);
      if (space?.id !== saved)
        queueMicrotask(() =>
          setNotice(
            'The saved space is unavailable. Showing ' +
              (space?.name ?? 'the default space') +
              ' instead.',
          ),
        );
      if (space)
        queueMicrotask(() => {
          setFocusCompletion({ scope: '', request: '', code: null, count: 0 });
          setFocusOnRestore(false);
          setFocusEpoch((epoch) => epoch + 1);
          setSelection({ space, code: null, page: 1 });
        });
    }
    return () => window.removeEventListener('popstate', pop);
  }, [locations, initialSpace, initialCode, initialPage, userId]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        'inventory-space:' + userId + ':' + window.location.origin,
        selection.space.id,
      );
    } catch {
      /* Optional preference only. */
    }
  }, [selection.space.id, userId]);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    if (!selection.code) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      space: selection.space.id,
      location: selection.code,
      page: String(selection.page),
    });
    // Track the genuine owned request even when an already-validated pane is
    // reused. Renderer/shader readiness and stale requests never acknowledge it.
    startContentsRequest(
      () =>
        fetch('/api/room/contents?' + params, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })
          .then(async (response) => {
            if (
              !response.ok ||
              !response.headers
                .get('content-type')
                ?.includes('application/json')
            )
              throw new Error(
                response.status === 401 || response.redirected
                  ? 'Sign in again to load inventory.'
                  : 'Inventory could not be loaded.',
              );
            const raw: unknown = await response.json();
            return parseRoomContentsResponse(raw, {
              userId,
              environment: window.location.origin,
              spaceId: selection.space.id,
              locationCode: selection.code!,
              filter: roomContentsFilter,
              page: selection.page,
            }).result;
          })
          .then((data) => {
            if (active && current === generation.current) {
              const lastPage = Math.max(
                1,
                Math.ceil(data.total / data.pageSize),
              );
              if (data.page > lastPage) {
                const url = new URL(window.location.href);
                if (lastPage > 1)
                  url.searchParams.set('page', String(lastPage));
                else url.searchParams.delete('page');
                window.history.replaceState(
                  null,
                  '',
                  url.pathname + url.search + url.hash,
                );
                setAcceptedRouteKey(routeKey(url.pathname, url.searchParams));
                setSelection((previous) => ({ ...previous, page: lastPage }));
                return;
              }
              setContents({ key: attemptKey, result: data });
            }
          })
          .catch((cause) => {
            if (
              active &&
              current === generation.current &&
              !controller.signal.aborted
            ) {
              setContents({
                key: attemptKey,
                error:
                  cause instanceof Error &&
                  [
                    'Sign in again to load inventory.',
                    'Inventory response identity did not match the selected location.',
                    'Inventory response failed validation.',
                  ].includes(cause.message)
                    ? cause.message
                    : 'Inventory could not be loaded.',
              });
            }
          }),
      controller.signal,
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    requestKey,
    retryTick,
    attemptKey,
    selection.space.id,
    selection.code,
    selection.page,
    userId,
    startContentsRequest,
  ]);
  const navigate = useCallback(
    (next: Selection) => {
      if (next.space.id !== selection.space.id || next.code !== selection.code)
        setFocusEpoch((epoch) => epoch + 1);
      if (next.space.id !== selection.space.id || next.code !== selection.code)
        setFocusOnRestore(Boolean(next.code));
      if (next.space.id !== selection.space.id)
        setFocusCompletion({ scope: '', request: '', code: null, count: 0 });
      const params = new URLSearchParams();
      params.set('space', next.space.id);
      if (next.code) params.set('location', next.code);
      if (next.page > 1) params.set('page', String(next.page));
      window.history.pushState(null, '', '/room?' + params);
      setAcceptedRouteKey(routeKey('/room', params));
      setSelection(next);
      setNotice(null);
    },
    [selection.space.id, selection.code],
  );
  const selectCode = (code: string) => {
    const location = locations.find((item) => item.code === code);
    if (!location) return;
    const space = containingSpace(locations, code);
    if (!space) return;
    if (selection.code === code && selection.space.id === space.id) {
      setFocusOnRestore(true);
      setFocusTick((tick) => tick + 1);
      return;
    }
    setSceneError(null);
    navigate({ space, code, page: 1 });
  };
  const pages = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;
  return (
    <div className={styles.workspace}>
      <AmbientLight className="experience-ambient-spaces" />
      {notice && (
        <p
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100"
        >
          {notice}
        </p>
      )}
      <CanvasFreeRouteContent>
        <div className={styles.commandBar}>
          <label htmlFor="space-selector" className={styles.spaceLabel}>
            Space
          </label>
          <select
            id="space-selector"
            className={styles.spaceSelect}
            value={selection.space.id}
            onChange={(event) => {
              const next = resolveSpace(locations, event.target.value, null);
              if (next) {
                setSceneError(null);
                navigate({ space: next, code: null, page: 1 });
              }
            }}
          >
            {availableSpaces(locations).map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
          {room && (
            <button
              className={styles.commandButton}
              onClick={() => {
                if (visible) setFocusOnRestore(false);
                setVisible((value) => !value);
                setRetryTick((tick) => tick + 1);
              }}
            >
              {visible ? 'Hide room' : 'Show room'}
            </button>
          )}
          {selection.code && (
            <button
              className={styles.commandButton}
              onClick={() => navigate({ ...selection, code: null, page: 1 })}
            >
              Clear selection
            </button>
          )}
          <Link className={styles.commandLink} href="/inventory">
            Search inventory
          </Link>
        </div>
      </CanvasFreeRouteContent>
      {showCounts && room && visible && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="status">
            {occupancy.status === 'loading'
              ? 'Refreshing item counts…'
              : occupancy.status === 'error'
                ? 'Item counts unavailable. Refresh to try again.'
                : 'Counts are a snapshot of active items: one per positive-stock quantity item and active individual asset at each leaf location.'}
          </p>
          <button
            className={styles.commandButton}
            onClick={() => setRetryTick((tick) => tick + 1)}
          >
            Refresh inventory
          </button>
        </div>
      )}
      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          {room && visible ? (
            <div
              data-testid="room-viewer"
              data-selected-code={selection.code ?? ''}
              data-focused-code={shownFocusCompletion.code ?? ''}
              data-focus-count={shownFocusCompletion.count}
              data-camera-view={
                viewKey ? JSON.stringify(initialView) : undefined
              }
              className={styles.viewer}
            >
              <div className={styles.viewerHeading}>
                <strong>{currentSpace.name} / measured map</strong>
                <span>
                  {sceneError
                    ? 'Select a location in the location browser'
                    : 'Select a location in the map or browser'}
                </span>
              </div>
              {sceneError ? (
                <div className={styles.fallback}>
                  <h2 className="font-semibold">Room view unavailable</h2>
                  <p className="mt-2 text-sm">
                    {sceneError} Browse locations and inventory below.
                  </p>
                  <button
                    className="mt-3 min-h-11 text-cyan-300 underline"
                    onClick={() => setSceneError(null)}
                  >
                    Retry room
                  </button>
                </div>
              ) : (
                <SceneBoundary
                  key={selection.space.id}
                  onFailure={() =>
                    setSceneError('The room renderer could not start.')
                  }
                >
                  <RoomScene
                    key={selection.space.id}
                    room={room}
                    showCounts={showCounts}
                    onCountsChange={(show) => {
                      setShowCounts(show);
                      setRetryTick((tick) => tick + 1);
                    }}
                    locationEntryCounts={occupancy.counts}
                    locationNames={Object.fromEntries(
                      locations.map((location) => [
                        location.code,
                        location.name,
                      ]),
                    )}
                    initialView={initialView}
                    onViewChange={(view) => {
                      if (viewKey) {
                        setCameraViews((current) => {
                          if (
                            JSON.stringify(current.get(viewKey)) ===
                            JSON.stringify(view)
                          )
                            return current;
                          return new Map(current).set(viewKey, view);
                        });
                      }
                    }}
                    bindings={bindings}
                    selectedCode={selection.code}
                    highlightedCodes={highlightedCodes}
                    focusRequest={focusRequest}
                    focusOnRestore={focusOnRestore && bound}
                    onSelect={selectCode}
                    onReady={() => {}}
                    onFailure={setSceneError}
                    onFocusComplete={(code) => {
                      if (activeFocusIdentity.current !== focusIdentity) return;
                      setFocusOnRestore(false);
                      setFocusCompletion((current) => ({
                        scope: focusScope,
                        request: focusIdentity,
                        code,
                        count:
                          current.scope === focusScope ? current.count + 1 : 1,
                      }));
                    }}
                    onFocusCancel={cancelFocus}
                    canFocusSelected={bound}
                    onRequestFocus={() => {
                      setFocusOnRestore(true);
                      setFocusTick((tick) => tick + 1);
                    }}
                  />
                </SceneBoundary>
              )}
            </div>
          ) : !room ? (
            <div className={styles.unmodeled}>
              <h2 className="text-xl font-semibold">
                {currentSpace.name} inventory
              </h2>
              <p className="mt-2 text-slate-300">
                This space has no measured map yet. Browse its logical locations
                and inventory here.
              </p>
            </div>
          ) : null}
          <RouteReady
            actorId={userId}
            routeKey={acceptedRouteKey}
            contentIdentity={attemptKey || selection.space.id}
            ready={!selection.code || Boolean(result || error)}
          >
            <CanvasFreeRouteContent>
              <section
                aria-label="Location inventory"
                aria-busy={loading}
                className={styles.inventoryPanel}
              >
                {selected ? (
                  <div
                    key={selection.space.id + ':' + selected.code}
                    className={reducedMotion ? undefined : styles.arrival}
                  >
                    <p className={styles.panelEyebrow}>Selected location</p>
                    <h2 className={styles.selectionTitle}>{selected.name}</h2>
                    <LocationCode code={selected.code} />
                    <p className={styles.breadcrumb}>
                      {selected.breadcrumb}
                      {!selected.can_hold_inventory
                        ? ' · Includes descendant inventory'
                        : ''}
                    </p>
                    <Link
                      className={styles.detailLink}
                      href={'/locations/' + encodeURIComponent(selected.code)}
                    >
                      Location details and history
                    </Link>
                  </div>
                ) : (
                  <div>
                    <p className={styles.panelEyebrow}>Location inventory</p>
                    <h2 className={styles.selectionTitle}>
                      {currentSpace.name}
                    </h2>
                    <p className={styles.breadcrumb}>
                      {countLabel(
                        scoped.filter((location) => location.can_hold_inventory)
                          .length,
                        'inventory destination',
                      )}{' '}
                      across{' '}
                      {countLabel(
                        scoped.filter(
                          (location) => !location.can_hold_inventory,
                        ).length,
                        'group',
                      )}
                      . Choose a location in{' '}
                      {room && visible && !sceneError
                        ? 'the map or browser'
                        : 'the location browser'}{' '}
                      to view its current contents.
                    </p>
                  </div>
                )}
                {loading && (
                  <p role="status" className={styles.contentsState}>
                    Loading contents for {selected?.name ?? 'selected location'}
                    …
                  </p>
                )}
                {error && (
                  <div role="alert" className={styles.contentsError}>
                    <p>{error}</p>
                    <button
                      className="min-h-11 text-cyan-300 underline"
                      onClick={() => setRetryTick((tick) => tick + 1)}
                    >
                      Retry contents
                    </button>
                  </div>
                )}
                {result && !loading && (
                  <div
                    key={attemptKey}
                    className={reducedMotion ? undefined : styles.arrival}
                  >
                    <p className="mb-2 text-sm">
                      Active only ·{' '}
                      {selected?.can_hold_inventory
                        ? 'At each listed destination'
                        : 'Selected area and descendant inventory'}
                    </p>
                    <InventoryCount result={result} />
                    {result.total === 0 ? (
                      <div className={styles.contentsState}>
                        <p>No active inventory here.</p>
                        <Link
                          className="inline-flex min-h-11 items-center text-cyan-300 underline"
                          href={
                            '/locations/' +
                            encodeURIComponent(selection.code!) +
                            '?status=all'
                          }
                        >
                          Include all statuses
                        </Link>
                      </div>
                    ) : (
                      <InventoryRows rows={result.rows} />
                    )}
                    {result.total > 0 && (
                      <nav
                        aria-label="Pagination"
                        className={styles.pagination}
                      >
                        <span>
                          Page {result.page} of {pages}
                        </span>
                        {result.page > 1 && (
                          <button
                            className="min-h-11 text-cyan-300 underline"
                            onClick={() =>
                              navigate({ ...selection, page: result.page - 1 })
                            }
                          >
                            Previous
                          </button>
                        )}
                        {result.page < pages && (
                          <button
                            className="min-h-11 text-cyan-300 underline"
                            onClick={() =>
                              navigate({ ...selection, page: result.page + 1 })
                            }
                          >
                            Next
                          </button>
                        )}
                      </nav>
                    )}
                  </div>
                )}
              </section>
            </CanvasFreeRouteContent>
          </RouteReady>
        </div>
        <CanvasFreeRouteContent>
          <LocationBrowser
            key={selection.space.id}
            locations={scoped}
            selectedCode={selection.code}
            onSelect={selectCode}
          />
        </CanvasFreeRouteContent>
      </div>
    </div>
  );
}
