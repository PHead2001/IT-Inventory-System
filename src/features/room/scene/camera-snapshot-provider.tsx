'use client';

import {
  createContext,
  useCallback,
  useContext,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  freshPresentationGrant,
  retainedPresentationGrantCurrent,
} from '@/components/experience/presentation-privacy';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  subscribeAssignmentInvalidation,
  subscribeAuthoritativeCleanup,
  subscribePrivacyRevocation,
} from '@/features/scan/assign-batch';
import {
  cameraAuthorityKey,
  createRoomCameraStore,
  emptyCameraSnapshot,
  type CameraAuthority,
} from './camera-snapshot-store';
import type { CameraView } from './camera-view';

function backendOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
const liveGrant = (authority: CameraAuthority) =>
  authority.revision === readPrivacyRevocationRevision() &&
  authority.epoch === assignmentEpoch();
const CameraSnapshots = createContext<{
  store: ReturnType<typeof createRoomCameraStore>;
  authority: CameraAuthority | null;
  ready: boolean;
} | null>(null);

export function RoomCameraSnapshotProvider({
  actorId,
  backend,
  children,
}: {
  actorId: string;
  backend: string;
  children: ReactNode;
}) {
  const privacy = usePrivacyReadiness();
  const [store] = useState(() => createRoomCameraStore(liveGrant));
  const subscribeAuthority = useCallback(
    (listener: () => void) => store.subscribe('', listener),
    [store],
  );
  const readAuthority = useCallback(() => store.snapshot(''), [store]);
  const committed = useSyncExternalStore(
    subscribeAuthority,
    readAuthority,
    emptySnapshot,
  );
  const canonicalBackend = backendOrigin(backend);
  const authority = useMemo<CameraAuthority | null>(() => {
    if (
      !actorId ||
      !canonicalBackend ||
      privacy.revocationRevision === undefined
    )
      return null;
    if (privacy.verifiedEpoch !== undefined)
      return Object.freeze({
        actorId,
        backend: canonicalBackend,
        generation: privacy.generation,
        revision: privacy.revocationRevision,
        epoch: privacy.verifiedEpoch,
      });
    const previous = committed.authority;
    return !privacy.ready &&
      previous &&
      previous.actorId === actorId &&
      previous.backend === canonicalBackend &&
      previous.generation === privacy.generation &&
      previous.revision === privacy.revocationRevision &&
      liveGrant(previous)
      ? previous
      : null;
  }, [
    actorId,
    canonicalBackend,
    privacy.generation,
    privacy.revocationRevision,
    privacy.verifiedEpoch,
    privacy.ready,
    committed.authority,
  ]);
  const ready = authority !== null && freshPresentationGrant(privacy);
  useInsertionEffect(() => {
    const remove = [
      subscribePrivacyRevocation(store.retire),
      subscribeAssignmentInvalidation(store.retire),
      subscribeAuthoritativeCleanup(store.retire),
    ];
    return () => {
      remove.forEach((unsubscribe) => unsubscribe());
      store.dispose();
    };
  }, [store]);
  useLayoutEffect(() => {
    store.authorize(
      authority,
      ready,
      authority !== null &&
        retainedPresentationGrantCurrent(privacy, {
          revision: authority.revision,
          epoch: authority.epoch,
        }),
    );
  }, [authority, ready, privacy, store]);
  const value = useMemo(
    () => ({ store, authority, ready }),
    [store, authority, ready],
  );
  return <CameraSnapshots value={value}>{children}</CameraSnapshots>;
}

const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyCameraSnapshot;
export function useRoomCameraSnapshot(
  key: string | null,
  actorId: string,
  backend: string,
) {
  const context = useContext(CameraSnapshots);
  const store = context?.store;
  const subscribe = useCallback(
    (listener: () => void) =>
      store && key ? store.subscribe(key, listener) : emptySubscribe(),
    [store, key],
  );
  const read = useCallback(
    () => (store && key ? store.snapshot(key) : emptyCameraSnapshot),
    [store, key],
  );
  const snapshot = useSyncExternalStore(subscribe, read, emptySnapshot);
  const authority = context?.authority;
  const permitted = Boolean(
    key &&
    context?.ready &&
    authority &&
    snapshot.writable &&
    snapshot.authority &&
    authority.actorId === actorId &&
    authority.backend === backendOrigin(backend) &&
    liveGrant(authority) &&
    cameraAuthorityKey(authority) === cameraAuthorityKey(snapshot.authority),
  );
  const descriptor = Object.freeze({});
  useLayoutEffect(() =>
    permitted && authority && key
      ? store?.bind(descriptor, key, cameraAuthorityKey(authority))
      : undefined,
  );
  const write = (view: CameraView) => store?.write(descriptor, view) ?? false;
  return {
    present: context !== null,
    view: permitted ? snapshot.view : null,
    write,
  };
}
