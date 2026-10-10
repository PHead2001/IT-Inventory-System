'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Component,
  useCallback,
  useMemo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import type { RoomDefinition } from './schema';
import type { LocationRef } from '../inventory/contracts-ui';
import { buildRoomBindings } from './bindings';
import { inventoryDescendantCodes } from '../locations/hierarchy';
import { LocationPicker } from '../locations/location-picker';
import { roomHref } from './navigation';
import {
  focusToken,
  sameFocusToken,
  type FocusToken,
} from './scene/spatial-reveal';

const RoomScene = dynamic(() => import('./scene/room-scene'), {
  ssr: false,
  loading: () => <p className="p-6 text-slate-400">Loading room renderer…</p>,
});
const control =
  'min-h-11 rounded-md border border-slate-600 px-3 py-2 text-sm disabled:opacity-50';
class SceneBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    onFailure: (message: string) => void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure('The room renderer could not start.');
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function RoomWorkspace({
  room,
  locations,
  selectedCode,
  children,
}: {
  room: RoomDefinition;
  locations: LocationRef[];
  selectedCode: string | null;
  children: ReactNode;
}) {
  // RSC navigation may deserialize an equal geometry object with a new identity.
  // Keep camera effects stable until geometry content actually changes.
  const serializedRoom = JSON.stringify(room);
  const stableRoom = useMemo(
    () => JSON.parse(serializedRoom) as RoomDefinition,
    [serializedRoom],
  );
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visible, setVisible] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const workspaceId = useId();
  const [selectionGeneration, setSelectionGeneration] = useState({
    code: selectedCode,
    generation: 0,
  });
  if (selectionGeneration.code !== selectedCode)
    setSelectionGeneration({
      code: selectedCode,
      generation: selectionGeneration.generation + 1,
    });
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [focusCount, setFocusCount] = useState(0);
  const bindings = useMemo(() => buildRoomBindings(stableRoom), [stableRoom]);
  const selected = locations.find((location) => location.code === selectedCode);
  const bound =
    !!selected && bindings.some((binding) => binding.code === selectedCode);
  const highlightedCodes = useMemo(
    () => inventoryDescendantCodes(locations, selectedCode),
    [locations, selectedCode],
  );
  const focusRequest = useMemo(
    () =>
      Object.freeze({
        code: bound ? selectedCode : null,
        requestId: focusTick,
        scope: workspaceId + '|' + stableRoom.roomId,
        generation: selectionGeneration.generation,
        fitBeforeFlight:
          selectionGeneration.generation === 0 && focusTick === 0,
      }),
    [
      bound,
      selectedCode,
      focusTick,
      stableRoom.roomId,
      workspaceId,
      selectionGeneration.generation,
    ],
  );
  const onReady = useCallback(() => setReady(true), []);
  const onFailure = useCallback((message: string) => setFailure(message), []);
  const activeFocusToken = useRef<FocusToken | null>(null);
  useLayoutEffect(() => {
    activeFocusToken.current = focusToken(focusRequest, stableRoom.roomId);
  }, [focusRequest, stableRoom.roomId]);
  const onFocusComplete = useCallback(
    (code: string | null, token?: FocusToken) => {
      if (token && !sameFocusToken(token, activeFocusToken.current)) return;
      setFocusedCode(code);
      setFocusCount((count) => count + 1);
    },
    [],
  );
  const requestFocus = () => {
    setFocusedCode(null);
    setFocusTick((tick) => tick + 1);
  };
  const select = (code: string) => {
    if (!locations.some((location) => location.code === code)) return;
    if (code === selectedCode) requestFocus();
    else startTransition(() => router.push(roomHref(code), { scroll: false }));
  };
  const fallback = (
    <div className="p-6" role="status">
      <h2 className="font-semibold">Room view unavailable</h2>
      <p className="mt-2 text-sm text-slate-400">
        {failure ?? 'WebGL could not be initialized.'} Select a location below
        to browse inventory.
      </p>
      <button
        className={control}
        onClick={() => {
          setReady(false);
          setFailure(null);
        }}
      >
        Retry room
      </button>
    </div>
  );
  return (
    <div className="mt-6 min-w-0 space-y-5">
      <div className="flex flex-wrap gap-3">
        <button
          className={control}
          onClick={() => {
            setReady(false);
            setFocusedCode(null);
            setVisible((value) => !value);
          }}
          aria-expanded={visible}
        >
          {visible ? 'Hide room' : 'Show room'}
        </button>
        <button
          className={control}
          disabled={!selectedCode || pending}
          onClick={() =>
            startTransition(() =>
              router.push(roomHref(null), { scroll: false }),
            )
          }
        >
          Clear selection
        </button>
        <Link className={control} href="/inventory">
          Search inventory
        </Link>
      </div>
      <p className="text-sm text-slate-400">
        Use the room controls to rotate, zoom, and focus. The location picker
        works without the room.
      </p>
      <div
        className={
          visible
            ? 'grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]'
            : 'space-y-5'
        }
      >
        {visible && (
          <div
            data-testid="room-viewer"
            data-state={failure ? 'failed' : ready ? 'ready' : 'loading'}
            data-selected-code={selectedCode ?? ''}
            data-focused-code={
              focusedCode === selectedCode ? (focusedCode ?? '') : ''
            }
            data-focus-count={focusCount}
            className="min-w-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
          >
            {failure ? (
              fallback
            ) : (
              <SceneBoundary fallback={fallback} onFailure={onFailure}>
                <RoomScene
                  room={stableRoom}
                  locationNames={Object.fromEntries(
                    locations.map((location) => [location.code, location.name]),
                  )}
                  bindings={bindings}
                  selectedCode={selectedCode}
                  highlightedCodes={highlightedCodes}
                  focusRequest={focusRequest}
                  onSelect={select}
                  onReady={onReady}
                  onFailure={onFailure}
                  onFocusComplete={onFocusComplete}
                  canFocusSelected={bound && !pending}
                  onRequestFocus={requestFocus}
                />
              </SceneBoundary>
            )}
          </div>
        )}
        <div className="min-w-0 space-y-5">
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <LocationPicker
              id="room-location"
              label="Select location"
              locations={locations}
              mode="browse"
              value={selectedCode ?? ''}
              disabled={pending}
              onValueChange={(code) => {
                if (code) select(code);
                else
                  startTransition(() =>
                    router.push(roomHref(null), { scroll: false }),
                  );
              }}
            />
            <p role="status" className="mt-3 text-sm">
              {pending
                ? 'Loading selected location…'
                : selected
                  ? 'Selected: ' +
                    selected.breadcrumb +
                    ' (' +
                    selected.code +
                    ')'
                  : selectedCode
                    ? 'Selected code ' + selectedCode + ' is unavailable.'
                    : 'No location selected.'}
            </p>
            {selectedCode && !bound && (
              <p className="mt-3 text-sm text-amber-200">
                No modeled location is available for this code. Conventional
                location and inventory views remain available.
              </p>
            )}
          </div>
          <section
            aria-label="Location inventory"
            aria-busy={pending}
            className="min-w-0 space-y-4"
          >
            {children}
          </section>
        </div>
      </div>
    </div>
  );
}
