'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Component,
  useCallback,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import type { RoomDefinition } from './schema';
import type { LocationRef } from '../inventory/contracts-ui';
import { buildRoomBindings } from './bindings';
import { inventoryDescendantCodes } from '../locations/hierarchy';
import { roomHref } from './navigation';

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
    () => ({ code: bound ? selectedCode : null, requestId: focusTick }),
    [bound, selectedCode, focusTick],
  );
  const onReady = useCallback(() => setReady(true), []);
  const onFailure = useCallback((message: string) => setFailure(message), []);
  const onFocusComplete = useCallback((code: string | null) => {
    setFocusedCode(code);
    setFocusCount((count) => count + 1);
  }, []);
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
          onClick={requestFocus}
          disabled={!bound || !visible || !!failure || pending}
        >
          Focus selected
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
        Drag to rotate, use the wheel to zoom, or use the view controls. The
        location picker works without the room.
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
                  bindings={bindings}
                  selectedCode={selectedCode}
                  highlightedCodes={highlightedCodes}
                  focusRequest={focusRequest}
                  onSelect={select}
                  onReady={onReady}
                  onFailure={onFailure}
                  onFocusComplete={onFocusComplete}
                />
              </SceneBoundary>
            )}
          </div>
        )}
        <div className="min-w-0 space-y-5">
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <label className="mb-2 block font-medium" htmlFor="room-location">
              Select location
            </label>
            <select
              id="room-location"
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-600 bg-slate-950 px-3 text-sm"
              value={selected?.code ?? ''}
              disabled={pending}
              onChange={(event) =>
                event.target.value
                  ? select(event.target.value)
                  : startTransition(() =>
                      router.push(roomHref(null), { scroll: false }),
                    )
              }
            >
              <option value="">Choose a location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.code}>
                  {location.breadcrumb} ({location.code})
                  {!bindings.some((binding) => binding.code === location.code)
                    ? ' — no room model'
                    : ''}
                </option>
              ))}
            </select>
            <p role="status" className="mt-3 text-sm">
              {pending
                ? 'Loading selected location…'
                : selected
                  ? 'Selected: ' +
                    selected.breadcrumb +
                    ' (' +
                    selected.code +
                    ')'
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
