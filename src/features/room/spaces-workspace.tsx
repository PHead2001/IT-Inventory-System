'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Component,
  useCallback,
  useEffect,
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
import { InventoryRows } from '../inventory/components/read-ui';
import { inventoryDescendantCodes } from '../locations/hierarchy';
import { buildRoomBindings } from './bindings';
import { LocationBrowser } from './location-browser';
import { parseRoomLocation } from './navigation';
import { cameraViewKey, type CameraView } from './scene/camera-view';
import {
  parseRoomContentsResponse,
  roomContentsFilter,
} from './contents-contract';
import type { Space } from './spaces';
import {
  availableSpaces,
  containingSpace,
  resolveSpace,
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
}: {
  locations: LocationRef[];
  userId: string;
  initialSpace: Space;
  initialCode: string | null;
  initialNotice?: string | null;
  initialPage?: number;
}) {
  const [selection, setSelection] = useState<Selection>({
    space: initialSpace,
    code: initialCode,
    page: initialPage,
  });
  const [contents, setContents] = useState<{
    key: string;
    result?: PageResult<InventoryResult>;
    error?: string;
  } | null>(null);
  const [visible, setVisible] = useState(true);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [focusTick, setFocusTick] = useState(0);
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
  const room = useMemo(() => spaceRoom(selection.space), [selection.space]);
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
  const initialView = viewKey ? (cameraViews.get(viewKey) ?? null) : null;
  const bindings = useMemo(() => (room ? buildRoomBindings(room) : []), [room]);
  const scoped = useMemo(
    () => spaceLocations(locations, selection.space),
    [locations, selection.space],
  );
  const selected = scoped.find((location) => location.code === selection.code);
  const bound =
    !!selected && bindings.some((binding) => binding.code === selected.code);
  const highlightedCodes = useMemo(
    () => inventoryDescendantCodes(scoped, selection.code),
    [scoped, selection.code],
  );
  const focusRequest = useMemo(
    () => ({ code: bound ? selection.code : null, requestId: focusTick }),
    [bound, selection.code, focusTick],
  );
  useEffect(() => {
    function pop() {
      setSelection(
        selectionFromUrl(locations, {
          space: initialSpace,
          code: initialCode,
          page: initialPage,
        }),
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
        queueMicrotask(() => setSelection({ space, code: null, page: 1 }));
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
    fetch('/api/room/contents?' + params, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers.get('content-type')?.includes('application/json')
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
      });
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
  ]);
  const navigate = useCallback((next: Selection) => {
    const params = new URLSearchParams();
    params.set('space', next.space.id);
    if (next.code) params.set('location', next.code);
    if (next.page > 1) params.set('page', String(next.page));
    window.history.pushState(null, '', '/room?' + params);
    setSelection(next);
    setNotice(null);
  }, []);
  const selectCode = (code: string) => {
    const location = locations.find((item) => item.code === code);
    if (!location) return;
    const space = containingSpace(locations, code);
    if (!space) return;
    if (selection.code === code && selection.space.id === space.id) {
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
    <div className="mt-6 space-y-5">
      {notice && (
        <p
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100"
        >
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="space-selector" className="text-sm font-semibold">
          Space
        </label>
        <select
          id="space-selector"
          className="min-h-11 rounded-md border border-slate-600 bg-slate-900 px-3"
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
            className="min-h-11 rounded-md border border-slate-600 px-3"
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? 'Hide room' : 'Show room'}
          </button>
        )}
        {selection.code && (
          <button
            className="min-h-11 rounded-md border border-slate-600 px-3"
            onClick={() => navigate({ ...selection, code: null, page: 1 })}
          >
            Clear selection
          </button>
        )}
        <Link
          className="min-h-11 py-3 text-cyan-300 underline"
          href="/inventory"
        >
          Search inventory
        </Link>
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {room && visible ? (
            <div
              data-testid="room-viewer"
              data-selected-code={selection.code ?? ''}
              data-camera-view={
                viewKey ? JSON.stringify(initialView) : undefined
              }
              className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
            >
              {sceneError ? (
                <div className="p-6">
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
                    onSelect={selectCode}
                    onReady={() => {}}
                    onFailure={setSceneError}
                    onFocusComplete={() => {}}
                    canFocusSelected={bound}
                    onRequestFocus={() => setFocusTick((tick) => tick + 1)}
                  />
                </SceneBoundary>
              )}
            </div>
          ) : !room ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-8">
              <h2 className="text-xl font-semibold">
                {selection.space.name} inventory
              </h2>
              <p className="mt-2 text-slate-300">
                This space has no measured map yet. Browse its logical locations
                and inventory here.
              </p>
            </div>
          ) : null}
          <section
            aria-label="Location inventory"
            aria-busy={loading}
            className="min-w-0 space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4"
          >
            {selected ? (
              <>
                <h2 className="text-xl font-semibold">
                  {selected.name} ({selected.code})
                </h2>
                <p className="text-sm text-slate-300">
                  {selected.breadcrumb}
                  {!selected.can_hold_inventory
                    ? ' · Includes descendant inventory'
                    : ''}
                </p>
                <Link
                  className="text-sm text-cyan-300 underline"
                  href={'/locations/' + encodeURIComponent(selected.code)}
                >
                  Location details and history
                </Link>
              </>
            ) : (
              <p>Choose a location to view its inventory.</p>
            )}
            {loading && <p role="status">Loading contents…</p>}
            {error && (
              <div role="alert">
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
              <>
                <InventoryRows rows={result.rows} />
                <nav
                  aria-label="Pagination"
                  className="flex items-center gap-3 text-sm"
                >
                  <span>
                    {result.total} results · Page {result.page} of {pages}
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
              </>
            )}
          </section>
        </div>
        <LocationBrowser
          key={selection.space.id}
          locations={scoped}
          selectedCode={selection.code}
          onSelect={selectCode}
        />
      </div>
    </div>
  );
}
