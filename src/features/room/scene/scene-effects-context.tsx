'use client';
import {
  createContext,
  useContext,
  useId,
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
