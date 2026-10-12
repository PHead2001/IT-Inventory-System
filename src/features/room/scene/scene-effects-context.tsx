'use client';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { SceneSessionContext } from './scene-budget-provider';
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
  const supplied = useContext(SceneSessionContext);
  const [owner] = useState(() => supplied);
  const id = useId();
  const [session, setSession] = useState(() => ({
    room,
    generation: 0,
    store: createSceneEffectsStore(`${id}:0:${room.roomId}`, owner.current),
  }));
  if (session.room !== room) {
    const generation = session.generation + 1;
    setSession({
      room,
      generation,
      store: createSceneEffectsStore(
        `${id}:${generation}:${room.roomId}`,
        owner.current,
      ),
    });
  }
  useLayoutEffect(() => {
    const store = session.store;
    if (store.isDisposed() && owner.current()) {
      // Descendant layout effects reconnect before this parent setup in both
      // StrictMode and Activity. Publish a fresh context generation so those
      // effects rerun against a usable store; never reopen their retired owner.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reconnect must replace an irreversibly disposed external store before paint.
      setSession((current) => {
        if (
          !owner.current() ||
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
            owner.current,
          ),
        };
      });
    }
    return () => {
      if (!store.isDisposed()) store.dispose();
    };
  }, [id, session.room, session.store, owner]);
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
