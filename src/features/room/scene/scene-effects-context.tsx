'use client';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { RoomDefinition } from '../schema';
import {
  createSceneEffectsStore,
  type SceneEffectsStore,
} from './scene-effects-state';

const EffectsContext = createContext<SceneEffectsStore | null>(null);
export function SceneEffectsProvider({
  room,
  children,
}: {
  room: RoomDefinition;
  children: ReactNode;
}) {
  const id = useId();
  const [session, setSession] = useState(() => ({
    room,
    generation: 0,
    store: createSceneEffectsStore(`${id}:0:${room.roomId}`),
  }));
  if (session.room !== room) {
    const generation = session.generation + 1;
    setSession({
      room,
      generation,
      store: createSceneEffectsStore(`${id}:${generation}:${room.roomId}`),
    });
  }
  const retirements = useRef(new Map<SceneEffectsStore, object>());
  useLayoutEffect(() => {
    const store = session.store;
    const pending = retirements.current;
    // React's immediate StrictMode replay reacquires the same committed store.
    pending.delete(store);
    if (store.isDisposed()) {
      // Activity can reconnect retained state after its old store was retired.
      // Never revive it or replace a newer room/store from a stale setup.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconnect must replace an irreversibly disposed external store before paint.
      setSession((current) => {
        if (
          current.store !== store ||
          current.room !== session.room ||
          !current.store.isDisposed()
        )
          return current;
        const generation = current.generation + 1;
        return {
          room: current.room,
          generation,
          store: createSceneEffectsStore(
            `${id}:${generation}:${current.room.roomId}`,
          ),
        };
      });
    }
    return () => {
      const retirement = {};
      pending.set(store, retirement);
      queueMicrotask(() => {
        if (pending.get(store) !== retirement) return;
        pending.delete(store);
        if (!store.isDisposed()) store.dispose();
      });
    };
  }, [id, session.room, session.store]);
  return <EffectsContext value={session.store}>{children}</EffectsContext>;
}
export function useOptionalSceneEffects() {
  return useContext(EffectsContext);
}
export function useSceneEffects() {
  const effects = useOptionalSceneEffects();
  if (!effects) throw new Error('Room scene effects provider is required');
  return effects;
}
const empty = Object.freeze({ hoverCode: null });
const noSubscribe = () => () => {};
const emptySnapshot = () => empty;
export function useVisualHoverCode() {
  const effects = useOptionalSceneEffects();
  const state = useSyncExternalStore<Readonly<{ hoverCode: string | null }>>(
    effects?.subscribe ?? noSubscribe,
    effects?.getSnapshot ?? emptySnapshot,
    effects?.getSnapshot ?? emptySnapshot,
  );
  return state.hoverCode;
}
