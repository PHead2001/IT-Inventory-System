'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createSceneBudget } from './scene-budget';
const SceneBudgetContext = createContext<ReturnType<
  typeof createSceneBudget
> | null>(null);
export const ScenePriorityContext = createContext(1);
export const SceneSessionContext = createContext<{ current(): boolean }>({
  current: () => true,
});
export function RoomSceneBudgetProvider({ children }: { children: ReactNode }) {
  const [budget] = useState(createSceneBudget);
  useEffect(() => () => budget.dispose(), [budget]);
  return <SceneBudgetContext value={budget}>{children}</SceneBudgetContext>;
}
export function useSceneBudget() {
  const shared = useContext(SceneBudgetContext);
  // Standalone story/test hosts own their own bounded slot; production shares layout.
  const [local] = useState(createSceneBudget);
  return shared ?? local;
}
