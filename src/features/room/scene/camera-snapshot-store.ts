import { validCameraView, type CameraView } from './camera-view';

export type CameraAuthority = Readonly<{
  actorId: string;
  backend: string;
  generation: string;
  revision: number;
  epoch: number;
}>;
export const cameraAuthorityKey = (authority: CameraAuthority) =>
  JSON.stringify([
    authority.actorId,
    authority.backend,
    authority.generation,
    authority.revision,
    authority.epoch,
  ]);
type Snapshot = Readonly<{
  authority: CameraAuthority | null;
  incarnation: symbol | null;
  writable: boolean;
  view: CameraView | null;
}>;
export const emptyCameraSnapshot: Snapshot = Object.freeze({
  authority: null,
  incarnation: null,
  writable: false,
  view: null,
});
type Owner = {
  live: boolean;
  key: string;
  authority: string;
  incarnation: symbol;
};

function cloneView(view: CameraView) {
  if (
    !Array.isArray(view?.position) ||
    !Array.isArray(view?.target) ||
    !validCameraView(view)
  )
    return null;
  return Object.freeze({
    position: Object.freeze([
      ...view.position,
    ]) as unknown as CameraView['position'],
    target: Object.freeze([...view.target]) as unknown as CameraView['target'],
    zoom: view.zoom,
    mode: view.mode,
  });
}

/** One protected-layout instance. No inventory, module state or browser storage.
 * Per-key publication keeps camera dragging out of the surrounding layout. */
export function createRoomCameraStore(
  grantCurrent: (authority: CameraAuthority) => boolean,
  limit = 8,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8)
    throw new Error('Camera snapshot capacity must be between one and eight.');
  const records = new Map<string, Snapshot>();
  const listeners = new Map<string, Set<() => void>>();
  const owners = new Set<Owner>();
  const callbacks = new WeakMap<object, Owner>();
  let idle = emptyCameraSnapshot;
  let closed = false;
  const notify = (key: string) =>
    listeners.get(key)?.forEach((listener) => listener());
  const retireOwners = () => {
    owners.forEach((owner) => {
      owner.live = false;
    });
    owners.clear();
  };
  const publishAuthority = (next: Snapshot, clear: boolean) => {
    retireOwners();
    idle = next;
    if (clear) records.clear();
    else
      records.forEach((snapshot, key) =>
        records.set(key, Object.freeze({ ...next, view: snapshot.view })),
      );
    listeners.forEach((_, key) => notify(key));
  };
  const retire = () => {
    if (idle === emptyCameraSnapshot && !records.size && !owners.size) return;
    publishAuthority(emptyCameraSnapshot, true);
  };
  return {
    snapshot: (key: string) => records.get(key) ?? idle,
    subscribe: (key: string, listener: () => void) => {
      let group = listeners.get(key);
      if (!group) {
        group = new Set();
        listeners.set(key, group);
      }
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(key);
      };
    },
    authorize(
      authority: CameraAuthority | null,
      ready: boolean,
      retain: boolean,
    ) {
      if (closed) return;
      if (!authority || !grantCurrent(authority)) {
        retire();
        return;
      }
      const same =
        idle.authority &&
        cameraAuthorityKey(idle.authority) === cameraAuthorityKey(authority);
      if (!ready) {
        if (!same || !retain) {
          retire();
          return;
        }
        if (idle.writable)
          publishAuthority(Object.freeze({ ...idle, writable: false }), false);
        return;
      }
      if (same && idle.writable) return;
      publishAuthority(
        Object.freeze({
          authority: Object.freeze({ ...authority }),
          incarnation: Symbol(),
          writable: true,
          view: null,
        }),
        !same,
      );
    },
    bind(descriptor: object, key: string, authority: string) {
      if (
        closed ||
        callbacks.has(descriptor) ||
        !key ||
        !idle.writable ||
        !idle.incarnation ||
        !idle.authority ||
        cameraAuthorityKey(idle.authority) !== authority ||
        !grantCurrent(idle.authority)
      )
        return () => {};
      const owner: Owner = {
        live: true,
        key,
        authority,
        incarnation: idle.incarnation,
      };
      owners.add(owner);
      callbacks.set(descriptor, owner);
      return () => {
        owner.live = false;
        owners.delete(owner);
      };
    },
    write(descriptor: object, view: CameraView) {
      const owner = callbacks.get(descriptor);
      if (
        closed ||
        !owner?.live ||
        !idle.writable ||
        !idle.authority ||
        owner.incarnation !== idle.incarnation ||
        owner.authority !== cameraAuthorityKey(idle.authority) ||
        !grantCurrent(idle.authority)
      )
        return false;
      const cloned = cloneView(view);
      if (!cloned) return false;
      const previous = records.get(owner.key)?.view;
      if (JSON.stringify(previous) === JSON.stringify(cloned)) return true;
      records.delete(owner.key);
      records.set(owner.key, Object.freeze({ ...idle, view: cloned }));
      while (records.size > limit) {
        const evicted = records.keys().next().value!;
        records.delete(evicted);
        notify(evicted);
      }
      notify(owner.key);
      return true;
    },
    retire,
    dispose() {
      retire();
      closed = true;
      listeners.clear();
    },
  };
}
