'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LocationRef } from '../inventory/contracts-ui';
import { ShowInRoom } from './show-in-room';
import { RoomRegionBoundary } from './room-region-boundary';
const EmbeddedRoom = dynamic(
  () => import('./embedded-room').then((module) => module.EmbeddedRoom),
  { ssr: false },
);
const subscribeReady = () => () => {};

/** Detail readiness never waits for geometry, chunks, a GPU lease or camera motion. */
export function DetailRoomPreview({
  locations,
  choices,
  context,
}: {
  locations: LocationRef[];
  choices: { code: string; label: string }[];
  context?: string;
}) {
  const [choice, setChoice] = useState(
    choices.length === 1 ? choices[0].code : '',
  );
  const [visible, setVisible] = useState(false);
  const browserReady = useSyncExternalStore(
    subscribeReady,
    () => true,
    () => false,
  );
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const code = choices.length === 1 ? choices[0].code : choice;
  const selected = choices.some((option) => option.code === code)
    ? locations.find((location) => location.code === code)
    : undefined;
  return (
    <section
      ref={host}
      aria-label="Storage preview"
      className="my-5 min-w-0 rounded-xl border border-slate-700 p-4"
    >
      <h2 className="font-semibold">Storage preview</h2>
      {context && <p className="my-3 text-sm text-slate-400">{context}</p>}
      {choices.length > 1 && (
        <label className="my-3 block text-sm">
          Choose a recorded stock location
          <select
            className="mt-2 block min-h-11 w-full rounded-md border border-slate-600 bg-slate-950 px-3"
            value={selected?.code ?? ''}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose location</option>
            {choices.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected ? (
        <>
          <p className="my-3 text-sm">
            {selected.breadcrumb}
            {!selected.active &&
              ' · Inactive location; this is the recorded storage context.'}
          </p>
          {(visible ||
            (browserReady && typeof IntersectionObserver === 'undefined')) && (
            <RoomRegionBoundary key={selected.code}>
              <EmbeddedRoom
                locations={locations}
                code={selected.code}
                permittedCodes={[]}
                onSelect={() => {}}
              />
            </RoomRegionBoundary>
          )}
          <ShowInRoom location={selected} />
        </>
      ) : (
        <p className="my-3 text-sm">
          {choices.length > 1
            ? 'Choose a location to preview its map.'
            : 'No current modeled storage location to preview.'}
        </p>
      )}
    </section>
  );
}
