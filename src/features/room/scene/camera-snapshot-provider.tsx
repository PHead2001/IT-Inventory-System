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

/** Explicitly captured before crossing the separate Fiber root. */
export function useRoomSceneAuthority() {
  const context = useContext(CameraSnapshots);
  return context?.authority ?? null;
}

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
const deniedWrite: (view: CameraView) => boolean = () => false;
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
  const authorityKey = authority ? cameraAuthorityKey(authority) : null;
  const scope = useMemo(
    () => ({
      store,
      key,
      authorityKey,
      incarnation: snapshot.incarnation,
      permitted,
    }),
    [store, key, authorityKey, snapshot.incarnation, permitted],
  );
  const [binding, setBinding] = useState<{
    scope: typeof scope;
    write: (view: CameraView) => boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (!scope.permitted || !scope.store || !scope.key || !scope.authorityKey)
      return;
    const descriptor = Object.freeze({});
    const ownerStore = scope.store;
    const retire = ownerStore.bind(descriptor, scope.key, scope.authorityKey);
    // Canvas commits independently. Keep its writer alive across ordinary
    // workspace renders, but mint a new immutable owner after every effect
    // lifecycle (including Activity restoration) and authority/key change.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Publish the committed external-store owner; render cannot authorize a writer.
    setBinding({ scope, write: (view) => ownerStore.write(descriptor, view) });
    return retire;
  }, [scope]);
  return {
    present: context !== null,
    ready: context === null || (permitted && binding?.scope === scope),
    view: permitted ? snapshot.view : null,
    write: binding?.scope === scope ? binding.write : deniedWrite,
  };
}
