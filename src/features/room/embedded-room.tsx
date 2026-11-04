'use client';
import dynamic from 'next/dynamic';
import { useLayoutEffect, useState } from 'react';
import {
  CompactRoomContext,
  CompactRoomPlaceholder,
} from './compact-room-placeholder';
import type { LocationRef } from '../inventory/contracts-ui';
import { resolveRoomMap } from './room-map-model';
import { UnmodeledRoomNotice } from './unmodeled-room-notice';
import { ScenePriorityContext } from './scene/scene-budget-provider';
import { RoomRegionBoundary } from './room-region-boundary';
import { useRoomOccupancy } from './use-room-occupancy';
import { useRoomSceneAuthority } from './scene/camera-snapshot-provider';
import { cameraAuthorityKey } from './scene/camera-snapshot-store';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
import { pickerLocations } from '../locations/picker-model';
const RoomScene = dynamic(() => import('./scene/room-scene'), {
  ssr: false,
  loading: () => <CompactRoomPlaceholder />,
});
export function EmbeddedRoom({
  locations,
  code,
  permittedCodes,
  onSelect,
  selectionAllowed,
  priority = 0,
  selectionMode = 'select',
}: {
  locations: LocationRef[];
  code: string | null;
  permittedCodes: readonly string[];
  onSelect(code: string): void;
  selectionAllowed?(): boolean;
  priority?: number;
  selectionMode?: 'select' | 'preview';
}) {
  const model = resolveRoomMap(locations, code ?? permittedCodes[0] ?? null);
  const { space, room, bindings } = model;
  const spaceId = space?.id;
  const selectedIsBound = Boolean(code && model.selectedIsBound);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [graphicsActive, setGraphicsActive] = useState(false);
  const [showCounts, setShowCounts] = useState(false);
  const [focus, setFocus] = useState(0);
  const privacy = usePrivacyReadiness();
  const authority = useRoomSceneAuthority();
  const authorityKey = authority ? cameraAuthorityKey(authority) : null;
  const [countOwner] = useState(() => {
    let retired = false;
    return {
      key: authorityKey,
      generation: privacy.generation,
      retired: () => retired,
      retire: () => {
        retired = true;
      },
    };
  });
  useLayoutEffect(() => {
    if (
      countOwner.key !== authorityKey ||
      countOwner.generation !== privacy.generation
    )
      countOwner.retire();
  }, [countOwner, authorityKey, privacy.generation]);
  const countEligible = pickerLocations(locations, 'destination').some(
    (location) =>
      location.code === code &&
      !locations.some((child) => child.parentId === location.id),
  );
  const counts = useRoomOccupancy(
    Boolean(
      graphicsActive &&
      (!code || selectedIsBound) &&
      !countOwner.retired() &&
      countOwner.key === authorityKey &&
      countOwner.generation === privacy.generation &&
      ready &&
      !failure &&
      authority &&
      (showCounts || countEligible) &&
      freshPresentationGrant(privacy),
    ),
    authority?.actorId ?? '',
    spaceId ?? '',
    [code, attempt, authority ? cameraAuthorityKey(authority) : ''].join('|'),
    authority?.backend ?? '',
  );
  if (!room || (code && !selectedIsBound)) return <UnmodeledRoomNotice />;
  return (
    <CompactRoomContext
      value={{
        code,
        label:
          locations.find((location) => location.code === code)?.name ?? code,
      }}
    >
      <section
        aria-label="Location map"
        aria-busy={!ready && !failure}
        className="min-w-0 rounded-xl border border-slate-700"
      >
        {failure ? (
          <div className="p-4">
            <p role="status">
              Map unavailable. The recorded location and location browser remain
              available.
            </p>
            <button
              type="button"
              className="min-h-11 text-cyan-300 underline"
              onClick={() => {
                setFailure(null);
                setReady(false);
                setAttempt((value) => value + 1);
              }}
            >
              Retry map
            </button>
          </div>
        ) : (
          <RoomRegionBoundary key={space?.id + ':' + attempt}>
            <ScenePriorityContext value={priority}>
              <RoomScene
                compact
                compactCountStatus={
                  graphicsActive && ready && counts.status === 'loading'
                    ? 'Loading counts for the opened location…'
                    : graphicsActive && ready && counts.status === 'error'
                      ? 'Location counts are unavailable. The recorded location remains available.'
                      : ''
                }
                selectionMode={selectionMode}
                key={space?.id + ':' + attempt}
                room={room}
                bindings={bindings}
                locationNames={Object.fromEntries(
                  locations.map((location) => [location.code, location.name]),
                )}
                selectedCode={code}
                highlightedCodes={[]}
                locationOccupancy={counts.counts}
                showCounts={showCounts}
                onCountsChange={setShowCounts}
                onGraphicsActiveChange={(active) => {
                  setGraphicsActive(active);
                  if (!active) setReady(false);
                }}
                permittedCodes={permittedCodes}
                selectionAllowed={selectionAllowed}
                onSelect={onSelect}
                focusRequest={{
                  code: selectedIsBound ? code : null,
                  requestId: focus,
                  scope: 'embedded',
                  generation: attempt,
                  fitBeforeFlight: true,
                }}
                onReady={() => setReady(true)}
                onFailure={setFailure}
                onFocusComplete={() => {}}
                canFocusSelected={selectedIsBound}
                onRequestFocus={() => setFocus((value) => value + 1)}
              />
            </ScenePriorityContext>
          </RoomRegionBoundary>
        )}
      </section>
    </CompactRoomContext>
  );
}
